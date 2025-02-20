import * as zarr from "zarrita";
import * as omezarr from "ome-zarr.js";
import { slice } from "@zarrita/indexing";
import _ from 'underscore';

const ZARRITA_ARRAY_CACHE = {};
const ZARR_DATA_CACHE = {};

export async function loadZarrForPanel(zarrUrl) {
  let store = new zarr.FetchStore(zarrUrl);

  // we load smallest array. Only need it for min/max values if not in 'omero' metadata
  let datasetIndex = -1;
  const  {arr, shapes, multiscale, omero, scales, zarr_version} = await omezarr.getMultiscaleWithArray(store, datasetIndex);
  console.log({arr, shapes, multiscale, omero, scales, zarr_version})
  let zarrName = zarrUrl.split("/").pop();
  console.log("multiscale", multiscale);
  if (!multiscale) {
    alert(`Failed to load multiscale from ${zarrUrl}`);
    return;
  }

  let imgName = multiscale.name || zarrName;
  let axes = multiscale.axes;
  let axesNames = axes?.map((axis) => axis.name) || ["t", "c", "z", "y", "x"];

  let datasets = multiscale.datasets;
  let zarrays = {};
  // 'consolidate' the metadata for all arrays
  for (let ds of datasets) {
    let path = ds.path;
    let zarray = await fetch(`${zarrUrl}/${path}/.zarray`).then((rsp) =>
      rsp.json()
    );
    zarrays[path] = zarray;
  }
  // store under 'arrays' key
  let zarr_attrs = {
    multiscales: [multiscale],
  }
  zarr_attrs["arrays"] = zarrays;

  let zarray = zarrays[0];
  console.log("zarray", zarray);

  let dtype = zarray.dtype;
  let shape = zarray.shape;
  let dims = shape.length;
  let sizeX = shape[dims - 1];
  let sizeY = shape[dims - 2];
  let sizeZ = 1;
  let sizeT = 1;
  let sizeC = 1;
  if (axesNames.includes("z")) {
    sizeZ = shape[axesNames.indexOf("z")];
  }
  let defaultZ = parseInt(sizeZ / 2);
  if (axesNames.includes("t")) {
    sizeT = shape[axesNames.indexOf("t")];
  }
  let defaultT = parseInt(sizeT / 2);
  if (axesNames.includes("c")) {
    sizeC = shape[axesNames.indexOf("c")];
  }

  // channels...
  // if no omero data, need to construct channels!
  let default_colors = [
    "FF0000",
    "00FF00",
    "0000FF",
    "FFFF00",
    "00FFFF",
    "FFFFFF",
  ];
  let channels = omero?.channels;
  if (!channels) {
    // load smallest array to get min/max values for every channel
    let slices = omezarr.getSlices(_.range(sizeC), shape, axesNames, {});
    let promises = slices.map((chSlice) => zarr.get(arr, chSlice));
    let ndChunks = await Promise.all(promises);

    channels = _.range(sizeC).map((idx) => {
      let mm = omezarr.getMinMaxValues(ndChunks[idx]);
      return {
        label: "Ch" + idx,
        active: true,
        color: default_colors[idx],
        window: {
          min: mm[0],
          max: mm[1],
          start: mm[0],
          end: mm[1],
        },
      };
    });
  }

  let panelX = 0;
  let panelY = 0;
  let coords = {scale: 1};

  // ****** This is the Data Model ******
  //-------------------------------------
  // Any changes here will create a new version
  // of the model and will also have to be applied
  // to the 'version_transform()' function so that
  // older files can be brought up to date.
  // Also check 'previewSetId()' for changes.
  var n = {
    imageId: zarrUrl,
    name: imgName,
    width: sizeX * coords.scale,
    height: sizeY * coords.scale,
    sizeZ: sizeZ,
    theZ: defaultZ,
    sizeT: sizeT,
    theT: defaultT,
    rdefs: { model: "-" },
    channels: channels,
    orig_width: sizeX,
    orig_height: sizeY,
    x: panelX,
    y: panelY,
    // 'datasetName': data.meta.datasetName,
    // 'datasetId': data.meta.datasetId,
    // 'pixel_size_x': data.pixel_size.valueX,
    // 'pixel_size_y': data.pixel_size.valueY,
    // 'pixel_size_z': data.pixel_size.valueZ,
    // 'pixel_size_x_symbol': data.pixel_size.symbolX,
    // 'pixel_size_z_symbol': data.pixel_size.symbolZ,
    // 'pixel_size_x_unit': data.pixel_size.unitX,
    // 'pixel_size_z_unit': data.pixel_size.unitZ,
    // 'deltaT': data.deltaT,
    pixelsType: dtypeToPixelsType(dtype),
    // 'pixel_range': data.pixel_range,
    // let's dump the zarr data into the panel
    zarr: zarr_attrs,
  };
  console.log("Zarr Panel Model", n);

  return n;
}

// e.g. "<u1" -> "uint8"
function dtypeToPixelsType(dtype) {
  let dt = "";
  if (dtype.includes("u")) {
    dt += "uint";
  } else if (dtype.includes("i")) {
    dt += "int";
  } else if (dtype.includes("f")) {
    dt += "float";
  }
  if (dtype.includes("8")) {
    dt += "64";
  } else if (dtype.includes("4")) {
    dt += "32";
  } else if (dtype.includes("2")) {
    dt += "16";
  } else if (dtype.includes("1")) {
    dt += "8";
  }
  return dt;
};

export async function renderZarrToSrc(source, attrs, theZ, theT, channels, rect) {
  let paths = attrs.multiscales[0].datasets.map((d) => d.path);
  let axes = attrs.multiscales[0].axes?.map((a) => a.name) || [
    "t",
    "c",
    "z",
    "y",
    "x",
  ];
  let zarrays = attrs.arrays;

  // Pick first resolution that is below a max size...
  const MAX_SIZE = 500;
  // use the arrays themselves to determine 'scale', since we might
  // not have 'coordinateTransforms' for pre-v0.4 etc.
  console.log("Zarr pick size to render...", rect);
  let path;

  // size of full-size image
  let fullShape = zarrays[paths[0]].shape;

  let region_x = rect?.x || 0;
  let region_y = rect?.y || 0;
  let region_width = rect?.width || fullShape.at(-1);
  let region_height = rect?.height || fullShape.at(-2);

  // crop region for the downscaled array
  let array_rect;

  for (let p of paths) {
    let arrayAttrs = zarrays[p];
    console.log("checking path...", p, arrayAttrs.shape);
    let shape = arrayAttrs.shape;
    // E.g. if dataset shape is 1/2 of fullShape then crop size will be half
    let crop_w = region_width * shape.at(-1) / fullShape.at(-1);
    let crop_h = region_height * shape.at(-2) / fullShape.at(-2);

    if (crop_w * crop_h < MAX_SIZE * MAX_SIZE) {
      console.log("crop_w * crop_h < MAX_SIZE", crop_w * crop_h, MAX_SIZE * MAX_SIZE);
      array_rect = {
        x: Math.floor(region_x * shape.at(-1) / fullShape.at(-1)),
        y: Math.floor(region_y * shape.at(-2) / fullShape.at(-2)),
        width: Math.floor(crop_w),
        height: Math.floor(crop_h),
      }
      path = p;
      break;
    }
  }
  console.log("Orign array_rect", array_rect);

  // We can create canvas of the size of the array_rect
  const canvas = document.createElement("canvas");
  canvas.width = array_rect.width;
  canvas.height = array_rect.height;

  if (!path) {
    console.error(
      `Lowest resolution too large for rendering: > ${MAX_SIZE} x ${MAX_SIZE}`
    );
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
  let luts = [];
  let inverteds = [];
  channels.forEach((ch, index) => {
    if (ch.active) {
      activeChIndicies.push(index);
      colors.push(hexToRGB(ch.color));
      minMaxValues.push([ch.window.start, ch.window.end]);
      luts.push(ch.color.endsWith(".lut") ? ch.color : undefined);
      inverteds.push(ch.reverseIntensity);
    }
  });
  // console.log("activeChIndicies", activeChIndicies);
  // console.log("colors", colors);
  // console.log("minMaxValues", minMaxValues);

  // Need same logic as https://github.com/ome/omero-figure/blob/9cc36cde05bde4def7b62b07c2e9ae5f66712e96/omero_figure/views.py#L310
  // if we have a crop region outside the bounds of the image
  let array_shape = zarrays[path].shape;
  let size_x = array_shape.at(-1);
  let size_y = array_shape.at(-2);
  let paste_x = 0;
  let paste_y = 0;
  // let {x, y, width, height} = array_rect;
  if (array_rect.x < 0) {
    paste_x = - array_rect.x
    array_rect.width += array_rect.x;
    array_rect.x = 0;
  }
  if (array_rect.y < 0) {
    paste_y = - array_rect.y;
    array_rect.height += array_rect.y;
    array_rect.y = 0;
  }
  if (array_rect.x + array_rect.width > size_x) {
    array_rect.width = size_x - array_rect.x;
  }
  if (array_rect.y + array_rect.height > size_y) {
    array_rect.height = size_y - array_rect.y;
  }

  console.log("array_shape", array_shape);
  console.log("array_rect", array_rect);
  console.log("paste_x", paste_x);
  console.log("paste_y", paste_y);

  let promises = activeChIndicies.map((chIndex) => {
    let sliceKey = [];
    let slices = shape.map((dimSize, index) => {
      // channel
      if (index == chDim) {
        sliceKey.push("" + chIndex);
        return chIndex;
      }
      // x and y - crop to rect
      if (axes[index] == "x") {
        sliceKey.push(`${array_rect.x}:${array_rect.x + array_rect.width}`);
        return slice(array_rect.x, array_rect.x + array_rect.width);
      }
      if (axes[index] == "y") {
        sliceKey.push(`${array_rect.y}:${array_rect.y + array_rect.height}`);
        return slice(array_rect.y, array_rect.y + array_rect.height);
      }
      // z: TODO: handle case where lower resolution is downsampled in Z
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
    // console.log("cacheKey", cacheKey);
    // console.log("Zarr chIndex slices:", chIndex, "" + slices);
    // console.log("Zarr chIndex shape:", chIndex, shape);
    // TODO: add controller: { opts: { signal: controller.signal } }
    // check cache!
    if (ZARR_DATA_CACHE[cacheKey]) {
      console.log("RETURN cache!", ZARR_DATA_CACHE[cacheKey]);
      return ZARR_DATA_CACHE[cacheKey];
    }

    return zarr.get(arr, slices).then((data) => {
      console.log("populate cache...");
      ZARR_DATA_CACHE[cacheKey] = data;
      return data;
    });
  });

  let ndChunks = await Promise.all(promises);
  console.log("ndChunk", ndChunks[0].shape);
  console.log("array_rect", array_rect);

  let start = new Date().getTime();
  let rbgData = omezarr.renderTo8bitArray(
    ndChunks,
    minMaxValues,
    colors,
    luts,
    inverteds
  );
  console.log("renderTo8bitArray took", new Date().getTime() - start, "ms");

  let chunk_width = ndChunks[0].shape.at(-1);
  let chunk_height = ndChunks[0].shape.at(-2);

  const context = canvas.getContext("2d");
  context.fillStyle = "#ddd";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.putImageData(new ImageData(rbgData, chunk_width, chunk_height), paste_x, paste_y);
  let dataUrl = canvas.toDataURL("image/png");
  return dataUrl;
}

export function hexToRGB(hex) {
  if (hex.startsWith("#")) hex = hex.slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return [r, g, b];
}
