(function () {
  "use strict";

  function canvasFromSize(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  }

  function cropCanvas(source, x, y, width, height) {
    const canvas = canvasFromSize(width, height);
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(
      source, Math.round(x), Math.round(y), Math.round(width), Math.round(height),
      0, 0, canvas.width, canvas.height
    );
    return canvas;
  }

  function grayscalePixels(canvas) {
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const gray = new Uint8Array(canvas.width * canvas.height);
    for (let pixel = 0, index = 0; pixel < image.data.length; pixel += 4, index++) {
      gray[index] = Math.round(image.data[pixel] * 0.299 + image.data[pixel + 1] * 0.587 + image.data[pixel + 2] * 0.114);
    }
    return gray;
  }

  function otsuThreshold(gray, offset = 0) {
    const histogram = new Uint32Array(256);
    gray.forEach(value => histogram[value]++);
    const total = gray.length;
    let sum = 0;
    for (let value = 0; value < 256; value++) sum += value * histogram[value];
    let backgroundWeight = 0; let backgroundSum = 0; let bestVariance = -1; let threshold = 180;
    for (let value = 0; value < 256; value++) {
      backgroundWeight += histogram[value];
      if (!backgroundWeight) continue;
      const foregroundWeight = total - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += value * histogram[value];
      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (sum - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
      if (variance > bestVariance) { bestVariance = variance; threshold = value; }
    }
    return Math.max(105, Math.min(220, threshold + 18 + offset));
  }

  function denoiseGray(gray, width, height) {
    const output = new Uint8Array(gray);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        const values = [gray[index], gray[index - 1], gray[index + 1], gray[index - width], gray[index + width]].sort((a, b) => a - b);
        output[index] = values[2];
      }
    }
    return output;
  }

  function sharpenGray(gray, width, height, amount) {
    if (!amount) return gray;
    const output = new Uint8Array(gray);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        const average = (gray[index - 1] + gray[index + 1] + gray[index - width] + gray[index + width]) / 4;
        output[index] = Math.max(0, Math.min(255, Math.round(gray[index] + amount * (gray[index] - average))));
      }
    }
    return output;
  }

  function removeGridLines(gray, width, height, strength = 0) {
    if (!strength) return gray;
    const output = new Uint8Array(gray);
    const rowLimit = Math.max(0.72, 0.90 - strength * 0.12);
    const columnLimit = Math.max(0.80, 0.96 - strength * 0.10);
    for (let y = 0; y < height; y++) {
      let dark = 0;
      for (let x = 0; x < width; x++) if (gray[y * width + x] < 150) dark++;
      if (dark / width >= rowLimit) for (let x = 0; x < width; x++) output[y * width + x] = 255;
    }
    for (let x = 0; x < width; x++) {
      let dark = 0;
      for (let y = 0; y < height; y++) if (gray[y * width + x] < 150) dark++;
      if (dark / height >= columnLimit) for (let y = 0; y < height; y++) output[y * width + x] = 255;
    }
    return output;
  }

  function prepareCell(page, x1, y1, x2, y2, options = {}) {
    const trim = options.lineTrim || "light";
    const settings = trim === "strong"
      ? { x: 0.055, y: 0.13, minX: 8 }
      : trim === "none"
        ? { x: 0.012, y: 0.025, minX: 2 }
        : { x: 0.028, y: 0.055, minX: 4 };
    const insetXRatio = options.insetXRatio ?? settings.x;
    const insetYRatio = options.insetYRatio ?? settings.y;
    const insetX = Math.max(options.minimumInsetX ?? settings.minX, Math.round((x2 - x1) * insetXRatio));
    const insetY = Math.max(1, Math.round((y2 - y1) * insetYRatio));
    const cropped = cropCanvas(page, x1 + insetX, y1 + insetY, Math.max(2, x2 - x1 - insetX * 2), Math.max(2, y2 - y1 - insetY * 2));
    const context = cropped.getContext("2d", { willReadFrequently: true });
    const image = context.getImageData(0, 0, cropped.width, cropped.height);
    let gray = new Uint8Array(cropped.width * cropped.height);
    const histogram = new Uint32Array(256);
    for (let pixel = 0, index = 0; pixel < image.data.length; pixel += 4, index++) {
      gray[index] = Math.round(image.data[pixel] * 0.299 + image.data[pixel + 1] * 0.587 + image.data[pixel + 2] * 0.114);
      histogram[gray[index]]++;
    }
    const percentile = fraction => {
      const target = gray.length * fraction;
      let count = 0;
      for (let value = 0; value < 256; value++) { count += histogram[value]; if (count >= target) return value; }
      return 255;
    };
    const low = percentile(options.lowPercentile ?? 0.006);
    const high = Math.max(low + 24, percentile(options.highPercentile ?? 0.999));
    const normalizeAmount = options.normalizeAmount ?? 0.45;
    const contrast = options.contrast ?? 1.08;
    for (let index = 0; index < gray.length; index++) {
      const stretched = Math.max(0, Math.min(255, Math.round((gray[index] - low) * 255 / (high - low))));
      const normalized = gray[index] * (1 - normalizeAmount) + stretched * normalizeAmount;
      gray[index] = Math.max(0, Math.min(255, Math.round((normalized - 128) * contrast + 128)));
    }
    if (options.denoise) gray = denoiseGray(gray, cropped.width, cropped.height);
    gray = removeGridLines(gray, cropped.width, cropped.height, options.lineRemoval || 0);
    gray = sharpenGray(gray, cropped.width, cropped.height, options.sharpen || 0);
    for (let index = 0; index < gray.length; index++) {
      image.data[index * 4] = gray[index]; image.data[index * 4 + 1] = gray[index]; image.data[index * 4 + 2] = gray[index]; image.data[index * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);

    const scale = Math.max(3, Math.min(5, options.scale || 4));
    const padding = options.padding ?? 18;
    const output = canvasFromSize(cropped.width * scale + padding * 2, cropped.height * scale + padding * 2);
    const outputContext = output.getContext("2d", { willReadFrequently: true });
    outputContext.fillStyle = "white";
    outputContext.fillRect(0, 0, output.width, output.height);
    outputContext.imageSmoothingEnabled = options.smoothing !== false;
    outputContext.imageSmoothingQuality = "high";
    outputContext.drawImage(cropped, padding, padding, cropped.width * scale, cropped.height * scale);
    if (options.postSharpen) {
      const scaledImage = outputContext.getImageData(0, 0, output.width, output.height);
      let scaledGray = new Uint8Array(output.width * output.height);
      for (let pixel = 0, index = 0; pixel < scaledImage.data.length; pixel += 4, index++) scaledGray[index] = scaledImage.data[pixel];
      scaledGray = sharpenGray(scaledGray, output.width, output.height, options.postSharpen);
      for (let index = 0; index < scaledGray.length; index++) {
        scaledImage.data[index * 4] = scaledGray[index];
        scaledImage.data[index * 4 + 1] = scaledGray[index];
        scaledImage.data[index * 4 + 2] = scaledGray[index];
      }
      outputContext.putImageData(scaledImage, 0, 0);
    }
    if (options.threshold != null) {
      const outputImage = outputContext.getImageData(0, 0, output.width, output.height);
      const outputGray = new Uint8Array(output.width * output.height);
      for (let pixel = 0, index = 0; pixel < outputImage.data.length; pixel += 4, index++) outputGray[index] = outputImage.data[pixel];
      const threshold = options.threshold === "otsu" ? otsuThreshold(outputGray, options.thresholdOffset || 0) : options.threshold;
      for (let pixel = 0; pixel < outputImage.data.length; pixel += 4) {
        const value = outputImage.data[pixel] < threshold ? 0 : 255;
        outputImage.data[pixel] = value; outputImage.data[pixel + 1] = value; outputImage.data[pixel + 2] = value;
      }
      outputContext.putImageData(outputImage, 0, 0);
    }
    return output;
  }

  function rotateCanvas(source, degrees) {
    const radians = degrees * Math.PI / 180;
    const sin = Math.abs(Math.sin(radians));
    const cos = Math.abs(Math.cos(radians));
    const output = canvasFromSize(source.width * cos + source.height * sin, source.width * sin + source.height * cos);
    const context = output.getContext("2d", { willReadFrequently: true });
    context.fillStyle = "white";
    context.fillRect(0, 0, output.width, output.height);
    context.translate(output.width / 2, output.height / 2);
    context.rotate(radians);
    context.drawImage(source, -source.width / 2, -source.height / 2);
    return output;
  }

  function deskewCanvas(source) {
    const sampleScale = Math.min(1, 800 / source.width);
    const sample = canvasFromSize(source.width * sampleScale, source.height * sampleScale);
    sample.getContext("2d", { willReadFrequently: true }).drawImage(source, 0, 0, sample.width, sample.height);
    const gray = grayscalePixels(sample);
    const candidates = [];
    for (let degree = -3; degree <= 3.001; degree += 0.5) {
      const slope = Math.tan(degree * Math.PI / 180);
      const bins = new Uint32Array(sample.height + Math.ceil(sample.width * 0.06) + 8);
      for (let y = 0; y < sample.height; y += 2) {
        for (let x = 0; x < sample.width; x += 2) {
          if (gray[y * sample.width + x] < 145) {
            const bin = Math.round(y + x * slope + 4);
            if (bin >= 0 && bin < bins.length) bins[bin]++;
          }
        }
      }
      const peaks = [...bins].sort((a, b) => b - a).slice(0, Math.min(30, Math.max(8, Math.round(sample.height / 35))));
      candidates.push({ degree, score: peaks.reduce((sum, value) => sum + value * value, 0) });
    }
    const zero = candidates.find(candidate => candidate.degree === 0)?.score || 1;
    const best = [...candidates].sort((a, b) => b.score - a.score)[0];
    if (!best || Math.abs(best.degree) < 0.4 || best.score / zero < 1.10) return { canvas: source, angle: 0, confidence: 0 };
    return { canvas: rotateCanvas(source, best.degree), angle: best.degree, confidence: Math.min(1, best.score / zero - 1) };
  }

  window.OcrImageProcessing = Object.freeze({ canvasFromSize, cropCanvas, grayscalePixels, otsuThreshold, prepareCell, deskewCanvas });
})();
