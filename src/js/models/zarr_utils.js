
import * as zarr from "zarrita";
import { slice } from "@zarrita/indexing";

const ZARRITA_ARRAY_CACHE = {};
const ZARR_DATA_CACHE = {};

export async function renderZarrToSrc(source, attrs, theZ, theT, channels) {
  let paths = attrs.multiscales[0].datasets.map((d) => d.path);
  let axes = attrs.multiscales[0].axes.map((a) => a.name);
  let zarrays = attrs.arrays;

  // Pick first resolution that is below a max size...
  const MAX_SIZE = 2000;
  console.log("Zarr pick size to render...");
  let path;
  for (let p of paths) {
    let arrayAttrs = zarrays[p];
    console.log(path, arrayAttrs);
    let shape = arrayAttrs.shape;
    if (shape.at(-1) * shape.at(-2) < MAX_SIZE * MAX_SIZE) {
      path = p;
      break;
    }
  }

  if (!path) {
    console.error(`Lowest resolution too large for rendering: > ${MAX_SIZE} x ${MAX_SIZE}`);
    return;
  }
  
  console.log("Init zarr.FetchStore:", source + "/" + path);
  let storeArrayPath = source + "/" + path;
  let arr;
  if (ZARRITA_ARRAY_CACHE[storeArrayPath]) {
    arr = ZARRITA_ARRAY_CACHE[storeArrayPath];
  } else {
    let store = new zarr.FetchStore(source + "/" + path);
    arr = await zarr.open(store, { kind: "array" });
    ZARRITA_ARRAY_CACHE[storeArrayPath] = arr;
  }

  let chDim = axes.indexOf("c");
  let shape = zarrays[path].shape;
  let dims = shape.length;

  let activeChIndicies = [];
  let colors = [];
  let minMaxValues = [];
  channels.forEach((ch, index) => {
    if (ch.active) {
      activeChIndicies.push(index);
      colors.push(hexToRGB(ch.color));
      minMaxValues.push([ch.window.start, ch.window.end]);
    }
  });
  console.log("activeChIndicies", activeChIndicies);
  console.log("colors", colors);
  console.log("minMaxValues", minMaxValues);

  let promises = activeChIndicies.map((chIndex) => {
    let sliceKey = [];
    let slices = shape.map((dimSize, index) => {
      // channel
      if (index == chDim) {
        sliceKey.push("" + chIndex);
        return chIndex;
      }
      // x and y
      if (index >= dims - 2) {
        sliceKey.push(`${0}:${dimSize}`);
        return slice(0, dimSize);
      }
      // z
      if (axes[index] == "z") {
        sliceKey.push("" + theZ);
        return theZ;
      }
      if (axes[index] == "t") {
        sliceKey.push("" + theT);
        return theT;
      }
      return 0;
    });
    let cacheKey = `${source}/${path}/${sliceKey.join(",")}`;
    console.log("cacheKey", cacheKey);
    console.log("Zarr chIndex slices:", chIndex, "" + slices);
    console.log("Zarr chIndex shape:", chIndex, shape);
    // TODO: add controller: { opts: { signal: controller.signal } }
    // check cache!
    if (ZARR_DATA_CACHE[cacheKey]) {
      console.log("RETURN cache!", ZARR_DATA_CACHE[cacheKey]);
      return ZARR_DATA_CACHE[cacheKey];
    }

    return zarr.get(arr, slices).then(data => {
      console.log("populate cache...");
      ZARR_DATA_CACHE[cacheKey] = data;
      return data;
    });
  });

  let ndChunks = await Promise.all(promises);
  // let minMaxValues = ndChunks.map((ch) => getMinMaxValues(ch));
  let rbgData = renderTo8bitArray(ndChunks, minMaxValues, colors);

  let width = shape.at(-1);
  let height = shape.at(-2);
  
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.putImageData(new ImageData(rbgData, width, height), 0, 0);
  let dataUrl = canvas.toDataURL("image/png");
  return dataUrl;
}


export function renderTo8bitArray(ndChunks, minMaxValues, colors) {
  // Render chunks (array) into 2D 8-bit data for new ImageData(arr)
  // ndChunks is list of zarr arrays

  // assume all chunks are same shape
  const shape = ndChunks[0].shape;
  const height = shape[0];
  const width = shape[1];
  const pixels = height * width;

  if (!minMaxValues) {
    minMaxValues = ndChunks.map(getMinMaxValues);
  }

  // let rgb = [255, 255, 255];

  let rgba = new Uint8ClampedArray(4 * height * width).fill(0);
  let offset = 0;
  for (let y = 0; y < pixels; y++) {
    for (let p = 0; p < ndChunks.length; p++) {
      let rgb = colors[p];
      let data = ndChunks[p].data;
      let range = minMaxValues[p];
      let rawValue = data[y];
      let fraction = (rawValue - range[0]) / (range[1] - range[0]);
      // for red, green, blue,
      for (let i = 0; i < 3; i++) {
        // rgb[i] is 0-255...
        let v = (fraction * rgb[i]) << 0;
        // increase pixel intensity if value is higher
        rgba[offset * 4 + i] = Math.max(rgba[offset * 4 + i], v);
      }
    }
    rgba[offset * 4 + 3] = 255; // alpha
    offset += 1;
  }

  return rgba;
}

export function getMinMaxValues(chunk2d) {
  const data = chunk2d.data;
  let maxV = 0;
  let minV = Infinity;
  let length = chunk2d.data.length;
  for (let y = 0; y < length; y++) {
    let rawValue = data[y];
    maxV = Math.max(maxV, rawValue);
    minV = Math.min(minV, rawValue);
  }
  return [minV, maxV];
}

export const MAX_CHANNELS = 4;
export const COLORS = {
  cyan: "#00FFFF",
  yellow: "#FFFF00",
  magenta: "#FF00FF",
  red: "#FF0000",
  green: "#00FF00",
  blue: "#0000FF",
  white: "#FFFFFF",
};
export const MAGENTA_GREEN = [COLORS.magenta, COLORS.green];
export const RGB = [COLORS.red, COLORS.green, COLORS.blue];
export const CYMRGB = Object.values(COLORS).slice(0, -2);

export function getDefaultVisibilities(n) {
  let visibilities;
  if (n <= MAX_CHANNELS) {
    // Default to all on if visibilities not specified and less than 6 channels.
    visibilities = Array(n).fill(true);
  } else {
    // If more than MAX_CHANNELS, only make first set on by default.
    visibilities = [
      ...Array(MAX_CHANNELS).fill(true),
      ...Array(n - MAX_CHANNELS).fill(false),
    ];
  }
  return visibilities;
}

export function getDefaultColors(n, visibilities) {
  let colors = [];
  if (n == 1) {
    colors = [COLORS.white];
  } else if (n == 2) {
    colors = MAGENTA_GREEN;
  } else if (n === 3) {
    colors = RGB;
  } else if (n <= MAX_CHANNELS) {
    colors = CYMRGB.slice(0, n);
  } else {
    // Default color for non-visible is white
    colors = Array(n).fill(COLORS.white);
    // Get visible indices
    const visibleIndices = visibilities.flatMap((bool, i) => (bool ? i : []));
    // Set visible indices to CYMRGB colors. visibleIndices.length === MAX_CHANNELS from above.
    for (const [i, visibleIndex] of visibleIndices.entries()) {
      colors[visibleIndex] = CYMRGB[i];
    }
  }
  return colors.map(hexToRGB);
}

export function hexToRGB(hex) {
  if (hex.startsWith("#")) hex = hex.slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return [r, g, b];
}
