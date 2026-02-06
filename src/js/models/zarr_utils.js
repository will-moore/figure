import * as zarr from "zarrita";
import * as omezarr from "ome-zarr.js";
import { slice } from "zarrita";
import _ from 'underscore';
import { getJson, FILE_NOT_FOUND } from "../views/util.js";

const ZARRITA_ARRAY_CACHE = {};
const ZARR_DATA_CACHE = {};

export async function loadZarrForPanel(zarrUrl) {

  // first check if we have a zarr image...
  let zarrJson;
  try {
    zarrJson = await getJson(zarrUrl + "/zarr.json");
    zarrJson = zarrJson.attributes?.ome;   // zarr v3
  } catch (error) {
    console.log("Error loading zarr.json:", error);
    if (error.toString().includes(FILE_NOT_FOUND)) {
      try {
        zarrJson = await getJson(zarrUrl + "/.zattrs");
      } catch (error2) {
        return {"Error": error2.toString()};
      }
    } else {
      return {"Error": error.toString()};
    }
  }
  if (!zarrJson) {
    return {"Error": "Failed to load Zarr metadata"};
  }
  if (zarrJson["bioformats2raw.layout"]) {
    return {"Error": "bioformats2raw.layout is not currently supported"};
  }
  if (zarrJson.plate) {
    return {"Error": "OME-Zarr Plates are not currently supported"};
  }

  let store = new zarr.FetchStore(zarrUrl);

  // we load smallest array. Only need it for min/max values if not in 'omero' metadata
  let datasetIndex = -1;
  let msWithArray;
  try {
    msWithArray = await omezarr.getMultiscaleWithArray(store, datasetIndex);
  } catch (error) {
    console.error("Error loading Zarr:", error);
    return {"Error": error.toString()};
  }
  console.log("msWithArray", msWithArray);
  const {arr, shapes, multiscale, omero, scales, zarr_version} = msWithArray;
  let zarrName = zarrUrl.split("/").pop();
  console.log("multiscale", multiscale);
  if (!multiscale) {
    return {"Error": `Failed to load multiscale`};
  }

  let imgName = multiscale.name || zarrName;
  let axes = multiscale.axes;
  let axesNames = axes?.map((axis) => axis.name) || ["t", "c", "z", "y", "x"];

  let datasets = multiscale.datasets;
  let zarrays = {};
  // 'consolidate' the metadata for all arrays
  for (let ds of datasets) {
    let path = ds.path;
    let ds_array = await omezarr.getArray(store, path, zarr_version);
    zarrays[path] = {shape: ds_array.shape, dtype: ds_array.dtype};
  }
  // store under 'arrays' key
  let zarr_attrs = {
    multiscales: [multiscale],
  }
  zarr_attrs["arrays"] = zarrays;
  zarr_attrs["zarr_version"] = zarr_version;

  if (multiscale.version) {
    zarr_attrs["version"] = multiscale.version;
  } else if (zarr_version == "3") {
    zarr_attrs["version"] = zarrJson.version;
  }

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
  let chs = omero?.channels;
  let indices = {};
  if (axesNames.includes("z")) {
    indices["z"] = defaultZ;
  }
  // placeholder minmax values
  let minMaxs = _.range(sizeC).map((idx) => [0, 255]);
  let minMaxProvided = chs && chs.every((ch) => ch.window && ch.window.min != undefined && ch.window.max != undefined);
  if (!minMaxProvided) {
    // load smallest array to get min/max values for every channel
    let slices = omezarr.getSlices(_.range(sizeC), arr.shape, axesNames, indices, shapes[0]);
    let promises = slices.map((chSlice) => zarr.get(arr, chSlice));
    let ndChunks = await Promise.all(promises);

    minMaxs = _.range(sizeC).map((idx) => {
      return omezarr.getMinMaxValues(ndChunks[idx]);
    });
  }

  // use channel metadata if provided, otherwise default values or values from smallest array
  let channels = _.range(sizeC).map((idx) => {
    let ch = chs ? chs[idx] : null;
    let mm = [ch?.window?.min ?? minMaxs[idx][0], ch?.window?.max ?? minMaxs[idx][1]];

    return {
      label: ch?.label || "Ch" + idx,
      active: ch?.active !== undefined ? ch.active : true,
      color: ch?.color || default_colors[idx % default_colors.length],
      window: {
        min: mm[0],
        max: mm[1],
        start: ch?.window?.start ?? mm[0],
        end: ch?.window?.end ?? mm[1],
      },
    };
  });

  let deltaT = [];
  if (axesNames.includes("t")) {
    // if we have time units...
    let timeAxis = axes.find((a) => a.name == "t");
    if (timeAxis && timeAxis.unit) {
      let secsIncrement = 1;
      let scaleTransform0 = multiscale.datasets[0].coordinateTransformations?.find(
        (ct) => ct.type == "scale"
      );
      if (scaleTransform0) {
        secsIncrement = scaleTransform0.scale[axesNames.indexOf("t")];
      }
      const LENGTH_UNITS = {
        "nanosecond": 1e-9,
        "microsecond": 1e-6,
        "millisecond": 1e-3,
        "second": 1,
        "minute": 60,
        "hour": 3600,
      };
      if (LENGTH_UNITS[timeAxis.unit]) {
        secsIncrement = secsIncrement * LENGTH_UNITS[timeAxis.unit];
        for(let t = 0; t < sizeT; t++) {
          deltaT.push(t * secsIncrement);
        }
      }
    }
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
    // 'deltaT': data.deltaT,
    pixelsType: dtypeToPixelsType(dtype),
    // 'pixel_range': data.pixel_range,
    // let's dump the zarr data into the panel
    zarr: zarr_attrs,
  };

  if (deltaT.length > 0) {
    n['deltaT'] = deltaT;
  }

  // handle pixel sizes if available
  // Use 'scale' from first 'coordinateTransforms' if available
  let datasetScale = multiscale.datasets[0].coordinateTransformations?.find(
    (ct) => ct.type == "scale"
  );
  let msScale = multiscale.coordinateTransformations?.find(
    (ct) => ct.type == "scale"
  );
  if (datasetScale) {
    for (let dimName of ["x", "y", "z"]) {
      axes.forEach((axis, idx) => {
        if (axis.name == dimName) {
          let dimScale = datasetScale.scale[idx];
          if (msScale) {
            // also apply any 'scale' on multiscale.coordinateTransformations
            dimScale = dimScale * msScale.scale[idx];
          }
          // One OF: angstrom, attometer, centimeter, decimeter, exameter, femtometer, foot, gigameter, hectometer, inch, kilometer, megameter, meter, micrometer, mile, millimeter, nanometer, parsec, petameter, picometer, terameter, yard, yoctometer, yottameter, zeptometer, zettameter
          if (axis.unit) {
            let unitKey = axis.unit.toUpperCase();
            n['pixel_size_' + dimName] = dimScale;
            n['pixel_size_' + dimName + '_unit'] = unitKey;
            if (LENGTH_UNITS[unitKey]) {
              n['pixel_size_' + dimName + '_symbol'] = LENGTH_UNITS[unitKey].symbol;
            }
          }
        }
      });
    }
  }

  console.log("Zarr Panel Model...", n);

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

export async function renderZarrToSrc(source, attrs, theZ, theT, channels, rect, targetSize=500) {
  let paths = attrs.multiscales[0].datasets.map((d) => d.path);
  // for v0.3 each axes is a string, for v0.4+ it is an object
  let axes = attrs.multiscales[0].axes?.map((a) => a.name || a);
  // If no axes (v0.1, v0.2) it must be 5D
  axes = axes || ["t", "c", "z", "y", "x"];
  let zarrays = attrs.arrays;

  // Pick resolution where crop size is closest to targetSize
  // use the arrays themselves to determine 'scale', since we might
  // not have 'coordinateTransforms' for pre-v0.4 etc.
  let path;

  // size of full-size image
  let fullShape = zarrays[paths[0]].shape;

  let region_x = rect?.x || 0;
  let region_y = rect?.y || 0;
  let region_width = rect?.width || fullShape.at(-1);
  let region_height = rect?.height || fullShape.at(-2);
  let region_max_size = Math.max(region_width, region_height);

  let dsScales = paths.map((p) => zarrays[p].shape.at(-1) / fullShape.at(-1));
  // E.g. if dataset shape is 1/2 of fullShape then crop size will be half
  let cropSizes = dsScales.map((s) => region_max_size * s);

  // find the closest matching size...
  let targetScale;
  for (let i = 0; i < cropSizes.length; i++) {
    // if we've gone small enough, or at last one...
    if (cropSizes[i] <= targetSize || i == cropSizes.length - 1) {
      if (Math.abs(cropSizes[i] - targetSize) < Math.abs(cropSizes[Math.max(0, i - 1)] - targetSize)) {
        path = paths[i];
        targetScale = dsScales[i];
      } else {
        path = paths[Math.max(0, i - 1)];
        targetScale = dsScales[Math.max(0, i - 1)];
      }
      break;
    }
  }
  let array_rect = {
    x: Math.floor(region_x * targetScale),
    y: Math.floor(region_y * targetScale),
    width: Math.floor(region_width * targetScale),
    height: Math.floor(region_height * targetScale),
  };

  // Handle any Z-downsampling...
  let sizeZ = zarrays[paths[0]].shape[axes.indexOf("z")];
  let cropZ = zarrays[path].shape[axes.indexOf("z")];
  theZ = Math.floor(theZ *cropZ / sizeZ);

  // We can create canvas of the size of the array_rect
  const canvas = document.createElement("canvas");
  canvas.width = array_rect.width;
  canvas.height = array_rect.height;

  if (!path) {
    console.error(
      `Lowest resolution too large for rendering: > ${targetSize} x ${targetSize}`
    );
    return;
  }

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
    // If we have requested slice in cache, return that instead of loading chunks...
    if (ZARR_DATA_CACHE[cacheKey]) {
      if (ZARR_DATA_CACHE[cacheKey] !== "pending") {
        console.log("RETURN cache!", ZARR_DATA_CACHE[cacheKey]);
        return ZARR_DATA_CACHE[cacheKey];
      } else {
        // data is pending...
        console.log("PENDING cache...", cacheKey);
        // wait until data is populated, check every 100ms
        return new Promise((resolve, reject) => {
          let checkInterval = setInterval(() => {
            if (ZARR_DATA_CACHE[cacheKey] && ZARR_DATA_CACHE[cacheKey] !== "pending") {
              console.log("RESOLVE pending cache!", ZARR_DATA_CACHE[cacheKey]);
              clearInterval(checkInterval);
              resolve(ZARR_DATA_CACHE[cacheKey]);
            }
          }, 100);
        });
      }
    }

    // "pending" flag to avoid duplicate loads
    ZARR_DATA_CACHE[cacheKey] = "pending";
    return zarr.get(arr, slices).then((data) => {
      console.log("populate cache...");
      ZARR_DATA_CACHE[cacheKey] = data;
      return data;
    });
  });

  let ndChunks = await Promise.all(promises);
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
