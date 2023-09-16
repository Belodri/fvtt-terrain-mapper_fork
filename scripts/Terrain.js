/* globals
Dialog,
foundry,
game,
readTextFromFile,
renderTemplate,
saveDataToFile,
ui
*/
/* eslint no-unused-vars: ["error", { "argsIgnorePattern": "^_" }] */
"use strict";

import { FLAGS, COLORS, MODULE_ID } from "./const.js";
import { TerrainSettings } from "./settings.js";

/**
 * Subclass of Map that manages terrain ids and ensures only 1–31 are used.
 */
export class TerrainMap extends Map {
  /** @type {number} */
  MAX_TERRAINS = Math.pow(2, 5) - 1; // No 0 id.

  /** @type {number} */
  #nextId = 1;

  /** @override */
  set(id, terrain, override = false) {
    id ??= this.#nextId;

    if ( !override && this.has(id) ) {
      console.error("Id already present and override is false.");
      return;
    }

    if ( !Number.isInteger(id) || id < 1 ) {
      console.error(`Id ${id} is invalid.`);
      return;
    }

    if ( id > this.MAX_TERRAINS ) { console.warn(`Id ${id} exceeds maximum terrains (${this.MAX_TERRAINS}).`); }

    super.set(id, terrain);
    this.#nextId = this.#findNextId();
    return id;
  }

  /**
   * Add using the next consecutive id.
   */
  add(terrain) {
    const id = this.#nextId;
    if ( id > this.MAX_TERRAINS ) { console.warn(`Id ${id} exceeds maximum terrains (${this.MAX_TERRAINS}).`); }
    super.set(id, terrain);
    this.#nextId = this.#findNextId();
    return id;
  }

  /**
   * Locate the next id in consecutive order.
   */
  #findNextId() {
    // Next id is always the smallest available. So if it equals the size, we can just increment by 1.
    if ( this.size === (this.#nextId - 1) ) return this.#nextId + 1;

    const keys = [...this.keys()].sort((a, b) => a - b);
    const lastConsecutiveKey = keys.find((k, idx) => keys[idx + 1] !== k + 1);
    return lastConsecutiveKey + 1 ?? 1;
  }

  /** @override */
  clear() {
    super.clear();
    this.#nextId = 1;
  }

  /** @override */
  delete(id) {
    if ( !super.delete(id) ) return false;
    if ( this.#nextId > id ) this.#nextId = this.#findNextId();
    return true;
  }
}

/**
 * Terrain data is used here, but ultimately stored in flags in an active effect in a hidden item,
 * comparable to what DFred's does. The active effect can be used to apply the terrain to a token,
 * imposing whatever restrictions are desired.
 * Scenes store a TerrainMap that links each terrain to a pixel value.
 */
export class Terrain {
  // Default colors for terrains.
  static COLORS = COLORS;

  static #colorId = 0;

  static nextColor() { return this.COLORS[this.#colorId++]; }

  /** @type {number} */
  #pixelId;

  /**
   * @typedef {Object} TerrainConfig          Terrain configuration data
   * @property {string} name                  User-facing name of the terrain.
   * @property {string} icon                  URL of icon representing the terrain
   * @property {hex} color                    Hex value for the color representing the terrain
   * @property {FLAGS.ANCHOR.CHOICES} anchor  Measure elevation as fixed, from terrain, or from layer.
   * @property {number} offset                Offset elevation from anchor
   * @property {number} rangeAbove            How far above the offset the terrain extends
   * @property {number} rangeBelow            How far below the offset the terrain extends
   * @property {boolean} userVisible          Is this terrain visible to the user?
   * @property {ActiveEffect} activeEffect    Active effect associated with this terrain
   */
  config = {};

  /** @type {boolean} */
  userVisible = false;

  /** @type {ActiveEffect} */
  activeEffect;

  /** @type {TerrainSettings} */
  _settings;

  /**
   * @param {TerrainConfig} config
   * @param {object} [opts]
   * @param {boolean} [opts.override=false]     Should this terrain replace an existing id?
   */
  constructor(config = {}) {
    this._settings = new TerrainSettings();

    this.initializeConfiguration(config);
    this.userVisible ||= this.config.userVisible;


  }

  /**
   * Initialize certain undefined configuration values.
   */
  initializeConfiguration(config) {
    if ( )

    config.activeEffect ??= this._settings.terrainEffectsItem;


    this.config = foundry.utils.deepClone(config);



    // Initialize certain configurations.
    this.config.name ||= "";
    this.config.offset ||= 0;
    this.config.rangeBelow ||= 0;
    this.config.rangeAbove ||= 0;
    this.config.anchor ??= FLAGS.ANCHOR.CHOICES.RELATIVE_TO_TERRAIN;
    this.config.userVisible ||= false;
    this.config.icon ||= "icons/svg/mountain.svg";

    // Use the id to select a default terrain color.
    this.config.color ||= this.nextColor();
  }

  /**
   * Calculate the elevation min / max for a given anchor elevation.
   * @param {number} anchorE    Elevation of the anchor point.
   * @returns {object} Elevation min and max.
   *   - {number} min   Minimum elevation
   *   - {number} max   Maximum elevation
   */
  elevationMinMax(anchorE) {
    const { offset, rangeBelow, rangeAbove } = this.config;
    const e = anchorE + offset;
    return { min: e + rangeBelow, max: e + rangeAbove };
  }


  toJSON() {
    const out = this.config;
    out.activeEffect = out.activeEffect ? out.activeEffect.toJSON() : undefined;
    return out;
  }

  updateSource(json) {
    const config = this.config;
    for ( const [key, value] of Object.entries(json) ) {
      if ( key === "id" ) continue;
      if ( key === "activeEffect" ) {
        config.activeEffect = config.activeEffect ? config.activeEffect.updateSource(value) : new ActiveEffect(value);
        continue;
      }
      config[key] = value;
    }
  }

  static toJSON() {
    const json = [];
    return this.TERRAINS.forEach(t => json.push(t.toJSON()));
  }

  static saveToFile() {
    const data = this.toJSON() ?? {};
    data.flags ??= {};
    data.flags.exportSource = {
      world: game.world.id,
      system: game.system.id,
      coreVersion: game.version,
      systemVersion: game.system.version,
      terrainMapperVersion: game.modules.get(MODULE_ID).version
    };

    const filename = `${MODULE_ID}_terrains`;
    saveDataToFile(JSON.stringify(data, null, 2), "text/json", `${filename.json}`);
  }

  static importFromJSON(json) {
    console.debug("Need to process this json file!", json);
  }

  static async importFromFileDialog() {
    new Dialog({
      title: "Import Terrain Setting Data",
      content: await renderTemplate("templates/apps/import-data.html", {
        hint1: "You may import terrain settings data from an exported JSON file.",
        hint2: "This operation will update the terrain settings data and cannot be undone."
      }),
      buttons: {
        import: {
          icon: '<i class="fas fa-file-import"></i>',
          label: "Import",
          callback: html => {
            const form = html.find("form")[0];
            if ( !form.data.files.length ) return ui.notifications.error("You did not upload a data file!");
            readTextFromFile(form.data.files[0]).then(json => this.importFromJSON(json));
          }
        },
        no: {
          icon: '<i class="fas fa-times"></i>',
          label: "Cancel"
        }
      },
      default: "import"
    }, {
      width: 400
    }).render(true);
  }

}
