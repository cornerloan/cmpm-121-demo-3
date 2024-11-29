// deno-lint-ignore-file
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
  `&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>`;

const MAX_COINS = 10;
const MIN_COINS = 1;
const CACHE_EMOJI = "🪙";
const CACHE_EMOJI_SIZE = "32px comic-sans";

interface geoCacheCoinGridCell {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  hasCache: boolean;
  coins: number;
  coinIdentifiers: Coin[];
}

type geoCacheCoinGrid = Record<string, geoCacheCoinGridCell>;

interface Coin {
  id: string;
  i: number;
  j: number;
  serial: number;
}

interface myState {
  map: leaflet.Map;
  userMarker: leaflet.Marker;
  grid: geoCacheCoinGrid;
  heldCoins: Coin[];
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
  return leaflet.point(
    Math.abs(shift.x - zeroZero.x),
    Math.abs(shift.y - zeroZero.y),
  );
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

function makeMap(ui: myUI): leaflet.Map {
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

function makegeoCacheCoinGrid(state: myState): void {
  makeGrid(
    state.map,
    function (this: leaflet.GridLayer, coords: leaflet.Point) {
      const key = coords.toString();
      if (!(key in state.grid)) {
        state.grid[key] = makeGridCell(state, coords, this.getTileSize());
      }
      return state.grid[key].canvas;
    },
    {
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
    },
  );
}

function makeGrid(
  map: leaflet.Map,
  createTile: (this: leaflet.GridLayer, coords: leaflet.Point) => HTMLElement,
  options?: object,
): leaflet.GridLayer {
  return new (leafletExtend<leaflet.GridLayer>(leaflet.GridLayer, {
    createTile,
  }))({
    tileSize: distBetween(map, leaflet.latLng(TILE_DEGREES, TILE_DEGREES)),
    ...(options || {}),
  }).addTo(map);
}

function createUserPosition(map: leaflet.Map): leaflet.Marker {
  const marker = leaflet.marker(OAKES_CLASSROOM);
  marker.bindTooltip("You Are Here");
  marker.addTo(map);
  return marker;
}

function makeGridCell(
  state: myState,
  coords: leaflet.Point,
  size: leaflet.Point,
): geoCacheCoinGridCell {
  const canvas = document.createElement("canvas");
  canvas.width = size.x;
  canvas.height = size.y;
  const ctx = canvas.getContext("2d");

  const { hasCache, coins } = getRandomizedCacheData(
    coords,
    CACHE_SPAWN_PROBABILITY,
    MIN_COINS,
    MAX_COINS,
  );

  const coinIdentifiers: Coin[] = [];
  if (hasCache) {
    for (let serial = 0; serial < coins; serial++) {
      const coinLatLng = state.map.containerPointToLatLng(coords);
      const { i, j } = latLngToGridIndices(coinLatLng, TILE_DEGREES);

      const coin: Coin = {
        id: `${i}_${j}_${serial}`,
        i: i,
        j: j,
        serial: serial,
      };

      coinIdentifiers.push(coin);
    }

    canvas.onclick = (mouseEvent) => {
      showgeoCacheCoinCachePopup(state, coords, coinIdentifiers, mouseEvent);
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

  return { canvas, ctx, hasCache, coins, coinIdentifiers };
}

function showgeoCacheCoinCachePopup(
  state: myState,
  coords: leaflet.Point,
  coinIdentifiers: Coin[],
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
      status.innerHTML = `Coins at this location:`;

      const takeButton = addElementToDoc(elem, "button", {
        innerHTML: "Take a coin",
        onclick: () => {
          if (cell.coins > 0 && coinIdentifiers.length > 0) {
            const takenCoin = coinIdentifiers[0];
            coinIdentifiers.shift();
            state.heldCoins.push(takenCoin);
            cell.coins--;
            updatePopup();
            updateInventoryStatus(state);
          }
        },
      });

      const leaveButton = addElementToDoc(elem, "button", {
        innerHTML: "Leave a coin",
        onclick: () => {
          if (state.heldCoins.length > 0) {
            const coinToLeave = state.heldCoins.pop();
            if (coinToLeave) {
              cell.coinIdentifiers.push(coinToLeave);
              cell.coins = cell.coinIdentifiers.length;
            }
            updatePopup();
            updateInventoryStatus(state);
          }
        },
      });

      const takeAllButton = addElementToDoc(elem, "button", {
        innerHTML: "Take all",
        onclick: () => {
          state.heldCoins.push(...coinIdentifiers);
          cell.coins = 0;
          coinIdentifiers.length = 0;
          updatePopup();
          updateInventoryStatus(state);
        },
      });

      const leaveAllButton = addElementToDoc(elem, "button", {
        innerHTML: "Leave all",
        onclick: () => {
          cell.coinIdentifiers.push(...state.heldCoins);
          cell.coins = cell.coinIdentifiers.length;
          state.heldCoins = [];
          updatePopup();
          updateInventoryStatus(state);
        },
      });

      const updatePopup = () => {
        const cacheLatLng = latLngToGridIndices(
          state.map.containerPointToLatLng(coords),
          TILE_DEGREES,
        );
        status.innerHTML = `
          Cache at [${cacheLatLng.i}, ${cacheLatLng.j}]<br>
          ${cell.coins} GeoCache Coins<br>
          ${
          coinIdentifiers.map((coin) =>
            `Coin at [${coin.i}, ${coin.j}], Serial: ${coin.serial}`
          ).join("<br>")
        }
        `;
      };
      updatePopup();
    });

    setTimeout(() => state.map.openPopup(popupContent, latLng), 10);
  }
}

function latLngToGridIndices(
  latLng: leaflet.LatLng,
  gridSize: number,
): { i: number; j: number } {
  const i = Math.floor((latLng.lng - OAKES_CLASSROOM.lng) / gridSize);
  const j = Math.floor((latLng.lat - OAKES_CLASSROOM.lat) / gridSize);
  return { i, j };
}

function updateInventoryStatus(state: myState) {
  const inventorySummary = document.getElementById("inventory-total");
  if (inventorySummary) {
    inventorySummary.innerHTML = `Coins Collected: ${state.heldCoins.length}`;
  }

  const inventoryCoins = document.getElementById("held-coins");
  if (inventoryCoins && state.heldCoins.length > 0) {
    inventoryCoins.innerHTML = "";
    state.heldCoins.forEach((coin) => {
      const coinInfo = addElementToDoc(inventoryCoins, "p", {
        innerHTML: `Coin from [${coin.i}, ${coin.j}], Serial: ${coin.serial}`,
      });
    });
  } else {
    if (inventoryCoins) {
      inventoryCoins.innerHTML = "No coins in inventory.";
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const ui: myUI = {
    map: document.getElementById("map") as HTMLElement,
    inventorySummary: document.getElementById(
      "inventory-summary",
    ) as HTMLElement,
  };

  const map = makeMap(ui);
  const state: myState = {
    map: map,
    userMarker: createUserPosition(map),
    grid: {},
    heldCoins: [],
  };

  makegeoCacheCoinGrid(state);

  updateInventoryStatus(state);

  // Enable geolocation tracking
  enableGeolocationTracking(state);

  // Add event listeners for movement buttons
  document.getElementById("move-north")?.addEventListener(
    "click",
    () => moveUserMarker(state, "north"),
  );
  document.getElementById("move-south")?.addEventListener(
    "click",
    () => moveUserMarker(state, "south"),
  );
  document.getElementById("move-east")?.addEventListener(
    "click",
    () => moveUserMarker(state, "east"),
  );
  document.getElementById("move-west")?.addEventListener(
    "click",
    () => moveUserMarker(state, "west"),
  );
  document.getElementById("reset-button")?.addEventListener("click", () => {
    resetGame(state);
  });
});

function moveUserMarker(state: myState, direction: string) {
  const newPos = calculateNewPosition(state.userMarker.getLatLng(), direction);
  if (newPos) {
    updateUserMarkerPosition(state, newPos);
    regenerateGridIfNeeded(state, newPos);
  }
}

function calculateNewPosition(
  currentPos: leaflet.LatLng,
  direction: string,
): leaflet.LatLng | null {
  switch (direction) {
    case "north":
      return leaflet.latLng(currentPos.lat + TILE_DEGREES, currentPos.lng);
    case "south":
      return leaflet.latLng(currentPos.lat - TILE_DEGREES, currentPos.lng);
    case "east":
      return leaflet.latLng(currentPos.lat, currentPos.lng + TILE_DEGREES);
    case "west":
      return leaflet.latLng(currentPos.lat, currentPos.lng - TILE_DEGREES);
    case "reset":
      return OAKES_CLASSROOM;
    default:
      return null;
  }
}

function updateUserMarkerPosition(state: myState, newPos: leaflet.LatLng) {
  state.userMarker.setLatLng(newPos);
  state.map.setView(newPos);
}

function regenerateGridIfNeeded(state: myState, newPos: leaflet.LatLng) {
  makegeoCacheCoinGrid(state);
}

function enableGeolocationTracking(state: myState) {
  let watchId: number | null = null;

  const geolocationButton = document.getElementById("toggle-geolocation");
  let isTracking = false;

  geolocationButton?.addEventListener("click", () => {
    if (isTracking) {
      // Stop tracking
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      geolocationButton.innerText = "🌐";
      isTracking = false;
    } else {
      // Start tracking
      if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude, longitude } = position.coords;
            const newPos = leaflet.latLng(latitude, longitude);

            // Update user marker and map view
            state.userMarker.setLatLng(newPos);
            state.map.setView(newPos);

            // Optionally regenerate the grid based on new position
            makegeoCacheCoinGrid(state);
          },
          (error) => {
            console.error("Geolocation error:", error.message);
            alert("Unable to retrieve location.");
          },
          {
            enableHighAccuracy: true, // Use high accuracy if available
          },
        );
        geolocationButton.innerText = "⛔ Stop Tracking";
        isTracking = true;
      } else {
        alert("Geolocation is not supported by this browser.");
      }
    }
  });
}

function resetGame(state: myState) {
  // Clear the map markers and overlays
  state.map.eachLayer((layer) => {
    if (!(layer instanceof leaflet.TileLayer)) {
      state.map.removeLayer(layer);
    }
  });

  // Reset the player's position
  state.userMarker.remove(); // Remove the old marker
  state.userMarker = createUserPosition(state.map); // Create and store the new marker
  state.map.setView(OAKES_CLASSROOM, state.map.getZoom());

  // Clear the inventory
  state.heldCoins = [];
  updateInventoryStatus(state);

  // Reset grid data
  state.grid = {};
  makegeoCacheCoinGrid(state);
}

function getRandomizedCacheData(
  coords: leaflet.Point,
  spawnProbability: number,
  minCoins: number,
  maxCoins: number,
): { hasCache: boolean; coins: number } {
  const hasCache =
    luck(`has cache${coords.toString()}?`) > 1 - spawnProbability;
  const coins = hasCache
    ? Math.round(
      minCoins +
        luck(`how many coins at ${coords.toString()}?`) * (maxCoins - minCoins),
    )
    : 0;
  return { hasCache, coins };
}
