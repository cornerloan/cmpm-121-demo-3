// @deno-types="npm:@types/leaflet@^1.9.14"
import leaflet from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import "./leafletWorkaround.ts";
import { leafletExtend } from "./leafletWorkaround.ts";
import luck from "./luck.ts";

const OAKES_CLASSROOM = leaflet.latLng(36.98949379578401, -122.06277128548504);
const GAMEPLAY_ZOOM_LEVEL = 19;
const TILE_DEGREES = 1e-4;
const NEIGHBORHOOD_SIZE = 8;
const CACHE_SPAWN_PROBABILITY = 0.1;
const MAP_DATA_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const MAP_ATTRIBUTION =
  `&copy; <a href="http://www.openstreetmap.org/copyright">
    OpenStreetMap
  </a>`;

const MAX_COINS = 100;
const MIN_COINS = 1;

const CACHE_EMOJI = "🪙";
const CACHE_EMOJI_SIZE = "32px comic-sans";

interface geoCacheCoinGridCell {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  hasCache: boolean;
  coins: number;
}

type geoCacheCoinGrid = Record<string, geoCacheCoinGridCell>;
interface myState {
  map: leaflet.Map;
  userMarker: leaflet.Marker;
  grid: geoCacheCoinGrid;
  heldCoins: number;
}

interface myUI {
  map: HTMLElement;
  inventorySummary: HTMLElement;
}

function distBetween(map: leaflet.Map, latLng: leaflet.LatLng): leaflet.Point {
  const zeroZero = leaflet.point(0, 0);
  const zeroZeroLatLng = map.layerPointToLatLng(zeroZero);
  const shiftedLatLng = leaflet.latLng(
    zeroZeroLatLng.lat + latLng.lat,
    zeroZeroLatLng.lng + latLng.lng,
  );
  const shift = map.latLngToLayerPoint(shiftedLatLng);
  const dist = leaflet.point(
    Math.abs(shift.x - zeroZero.x),
    Math.abs(shift.y - zeroZero.y),
  );
  return dist;
}

function addElementToDoc<Tag extends keyof HTMLElementTagNameMap>(
  parent: Node | null,
  what: Tag,
  attrs?: Partial<HTMLElementTagNameMap[Tag]>,
  type?: (elem: HTMLElementTagNameMap[Tag]) => void,
): HTMLElementTagNameMap[Tag] {
  const elem = document.createElement(what);
  if (attrs !== undefined) Object.assign(elem, attrs);
  type?.call(elem, elem);
  parent?.appendChild(elem);
  return elem;
}

function makegeoCacheCoinGrid(state: myState, ui: myUI) {
  makeGrid(state.map, function (coords: leaflet.Point) {
    const key = coords.toString();
    let value: geoCacheCoinGridCell;
    if (key in state.grid) {
      value = state.grid[key];
    } else {
      value = makeGridCell(state, ui, coords, this.getTileSize());
      state.grid[key] = value;
    }
    return value.canvas;
  }, {
    bounds: leaflet.latLngBounds(
      leaflet.latLng(
        state.userMarker.getLatLng().lat + TILE_DEGREES * NEIGHBORHOOD_SIZE,
        state.userMarker.getLatLng().lng + TILE_DEGREES * NEIGHBORHOOD_SIZE,
      ),
      leaflet.latLng(
        state.userMarker.getLatLng().lat - TILE_DEGREES * NEIGHBORHOOD_SIZE,
        state.userMarker.getLatLng().lng - TILE_DEGREES * NEIGHBORHOOD_SIZE,
      ),
    ),
  });
}

function makeMap(ui: myUI) {
  const map = leaflet.map(ui.map, {
    center: OAKES_CLASSROOM,
    zoom: GAMEPLAY_ZOOM_LEVEL,
    minZoom: GAMEPLAY_ZOOM_LEVEL,
    maxZoom: GAMEPLAY_ZOOM_LEVEL,
    zoomControl: false,
    scrollWheelZoom: false,
  });
  leaflet.tileLayer(MAP_DATA_URL, {
    maxZoom: GAMEPLAY_ZOOM_LEVEL,
    attribution: MAP_ATTRIBUTION,
  }).addTo(map);
  return map;
}

function makeGrid(
  map: leaflet.Map,
  createTile: (this: leaflet.GridLayer, coords: leaflet.Point) => HTMLElement,
  options?: object,
): leaflet.GridLayer {
  return (new (leafletExtend<leaflet.GridLayer>(leaflet.GridLayer, {
    createTile,
  }))({
    tileSize: distBetween(map, leaflet.latLng(TILE_DEGREES, TILE_DEGREES)),
    ...(options || {}),
  })).addTo(map);
}

function createUserPosition(map: leaflet.Map) {
  const marker = leaflet.marker(OAKES_CLASSROOM);
  marker.bindTooltip("You Are Here");
  marker.addTo(map);
  return marker;
}

function makeGridCell(
  state: myState,
  ui: myUI,
  coords: leaflet.Point,
  size: leaflet.Point,
) {
  const canvas = document.createElement("canvas");
  canvas.width = size.x;
  canvas.height = size.y;
  const ctx = canvas.getContext("2d");
  const hasCache = luck(`has cache${coords.toString()}?`) >
    1 - CACHE_SPAWN_PROBABILITY;
  const coins = hasCache
    ? Math.round( //this is the function for lerp
      MIN_COINS +
        luck(
            `how many coins at ${GeolocationCoordinates.toString()}?${Date.now()}`,
          ) * //uses date.now to ensure each location has a different amount of coins
          (MAX_COINS - MIN_COINS),
    )
    : 0;
  if (hasCache) {
    canvas.onclick = (mouseEvent) => {
      showgeoCacheCoinCachePopup(state, ui, coords, mouseEvent);
    };
    if (ctx !== null) {
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = CACHE_EMOJI_SIZE;
      ctx.fillText(CACHE_EMOJI, 0, 0);
      ctx.restore();
    }
  }
  return { canvas, ctx, hasCache, coins };
}

function showgeoCacheCoinCachePopup(
  state: myState,
  ui: myUI,
  coords: leaflet.Point,
  mouseEvent: MouseEvent,
) {
  const key = coords.toString();
  if (key in state.grid) {
    const latLng = state.map.mouseEventToLatLng(mouseEvent);
    const cell = state.grid[key];
    const popupContent = addElementToDoc(null, "aside", {
      className: "map-popup",
    }, (elem) => {
      const status = addElementToDoc(elem, "p");
      const takeButton = addElementToDoc(elem, "button", {
        innerHTML: "Take a coin",
        onclick: () => {
          if (cell.coins > 0) {
            cell.coins--;
            state.heldCoins++;
            updatePopup();
            updateInventoryStatus(state, ui);
          }
        },
      });
      const leaveButton = addElementToDoc(elem, "button", {
        innerHTML: "Leave a coin",
        onclick: () => {
          if (state.heldCoins > 0) {
            cell.coins++;
            state.heldCoins--;
            updatePopup();
            updateInventoryStatus(state, ui);
          }
        },
      });
      addElementToDoc(elem, "br");
      const takeAllButton = addElementToDoc(elem, "button", {
        innerHTML: "Take all",
        onclick: () => {
          state.heldCoins += cell.coins;
          cell.coins = 0;
          updatePopup();
          updateInventoryStatus(state, ui);
        },
      });
      const leaveAllButton = addElementToDoc(elem, "button", {
        innerHTML: "Leave all",
        onclick: () => {
          cell.coins += state.heldCoins;
          state.heldCoins = 0;
          updatePopup();
          updateInventoryStatus(state, ui);
        },
      });
      const updatePopup = () => {
        status.innerHTML = `
          ${cell.coins} GeoCache Coins
        `;
        takeButton.disabled = cell.coins <= 0;
        leaveButton.disabled = state.heldCoins <= 0;
        takeAllButton.disabled = takeButton.disabled;
        leaveAllButton.disabled = leaveButton.disabled;
      };
      updatePopup();
    });
    setTimeout(
      () => state.map.openPopup(popupContent, latLng),
      10,
    );
  }
}

function updateInventoryStatus(state: myState, ui: myUI) {
  if (state.heldCoins > 0) {
    ui.inventorySummary.innerHTML = `
      ${state.heldCoins} GeoCache Coins
    `;
  } else {
    ui.inventorySummary.innerHTML = "0 GeoCache Coins";
  }
}

const myUI: myUI = {
  map: document.querySelector("#map")!,
  inventorySummary: document.querySelector("#inventory-total")!,
};

const finalMap = makeMap(myUI);

const myState: myState = {
  map: finalMap,
  userMarker: createUserPosition(finalMap),
  grid: {},
  heldCoins: 0,
};

makegeoCacheCoinGrid(myState, myUI);
