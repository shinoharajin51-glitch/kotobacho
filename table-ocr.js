(() => {
  const DARK_THRESHOLD = 165;
  const MIN_ROW_HEIGHT = 8;

  function canvasFromSize(width, height) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    return canvas;
  }

  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      const canvas = canvasFromSize(image.naturalWidth, image.naturalHeight);
      canvas.getContext("2d", { willReadFrequently: true }).drawImage(image, 0, 0);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function loadPdf(file, onProgress) {
    if (!window.pdfjsLib) throw new Error("PDF読み取りライブラリを読み込めませんでした。インターネット接続を確認してください");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
    const document = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      onProgress({ stage: "prepare", message: `PDF ${pageNumber} / ${document.numPages} ページを高解像度で準備中…` });
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.max(2, Math.min(4, 2800 / Math.max(base.width, base.height)));
      const viewport = page.getViewport({ scale });
      const canvas = canvasFromSize(viewport.width, viewport.height);
      await page.render({ canvasContext: canvas.getContext("2d", { willReadFrequently: true }), viewport }).promise;
      pages.push(canvas);
    }
    return pages;
  }

  async function loadSourcePages(file, onProgress) {
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name || "");
    return isPdf ? loadPdf(file, onProgress) : [await loadImage(file)];
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

  function groupPositions(positions, maxGap = 3) {
    if (!positions.length) return [];
    const groups = [[positions[0]]];
    for (let index = 1; index < positions.length; index++) {
      const group = groups[groups.length - 1];
      if (positions[index] - group[group.length - 1] <= maxGap) group.push(positions[index]);
      else groups.push([positions[index]]);
    }
    return groups.map(group => Math.round(group.reduce((sum, value) => sum + value, 0) / group.length));
  }

  function countHorizontalRules(source) {
    const gray = grayscalePixels(source);
    const rows = [];
    for (let y = 1; y < source.height - 1; y++) {
      let dark = 0;
      for (let x = 0; x < source.width; x += 2) {
        if (gray[y * source.width + x] < DARK_THRESHOLD) dark++;
      }
      if (dark >= source.width * 0.18) rows.push(y);
    }
    return groupPositions(rows, 4).length;
  }

  function splitPages(source) {
    if (source.width / source.height < 1.15) return [source];
    const gray = grayscalePixels(source);
    const start = Math.round(source.width * 0.40);
    const end = Math.round(source.width * 0.60);
    const radius = Math.max(3, Math.round(source.width * 0.006));
    let bestX = Math.round(source.width / 2);
    let bestScore = Infinity;
    for (let x = start; x <= end; x++) {
      let score = 0;
      for (let y = 0; y < source.height; y += 2) {
        for (let offset = -radius; offset <= radius; offset += 2) {
          if (gray[y * source.width + Math.max(0, Math.min(source.width - 1, x + offset))] < DARK_THRESHOLD) score++;
        }
      }
      if (score < bestScore) { bestScore = score; bestX = x; }
    }
    const sampled = Math.ceil(source.height / 2) * Math.ceil((radius * 2 + 1) / 2);
    if (bestScore > sampled * 0.18) return [source];
    const halves = [
      cropCanvas(source, 0, 0, bestX, source.height),
      cropCanvas(source, bestX, 0, source.width - bestX, source.height)
    ];
    // 白い中央だけでは分割せず、左右に十分な表の横罫線があることも確認する。
    return halves.every(half => countHorizontalRules(half) >= 8) ? halves : [source];
  }

  function findTable(page) {
    const width = page.width;
    const height = page.height;
    const gray = grayscalePixels(page);
    const horizontalCandidates = [];
    const minHorizontalInk = width * 0.40;
    for (let y = 1; y < height - 1; y++) {
      let count = 0;
      for (let x = 0; x < width; x++) {
        const dark = gray[(y - 1) * width + x] < DARK_THRESHOLD || gray[y * width + x] < DARK_THRESHOLD || gray[(y + 1) * width + x] < DARK_THRESHOLD;
        if (dark) count++;
      }
      if (count >= minHorizontalInk) horizontalCandidates.push(y);
    }
    let horizontalLines = groupPositions(horizontalCandidates, 4);
    horizontalLines = horizontalLines.filter((value, index) => index === 0 || value - horizontalLines[index - 1] >= MIN_ROW_HEIGHT);
    if (horizontalLines.length < 12) throw new Error("表の横罫線を十分に検出できませんでした");

    const lineEdges = horizontalLines.map(y => {
      let left = width; let right = 0;
      for (let scanY = Math.max(0, y - 2); scanY <= Math.min(height - 1, y + 2); scanY++) {
        for (let x = 0; x < width; x++) {
          if (gray[scanY * width + x] < DARK_THRESHOLD) { left = Math.min(left, x); right = Math.max(right, x); }
        }
      }
      return { y, left, right };
    }).filter(edge => edge.right > edge.left);
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const left = median(lineEdges.map(edge => edge.left));
    const right = median(lineEdges.map(edge => edge.right));
    const tableWidth = right - left;
    const top = horizontalLines[0];
    const bottom = horizontalLines[horizontalLines.length - 1];

    const verticalCandidates = [];
    const minVerticalInk = (bottom - top) * 0.42;
    for (let x = Math.max(0, left - 3); x <= Math.min(width - 1, right + 3); x++) {
      let count = 0; let run = 0; let longestRun = 0; let allowedGap = 0;
      for (let y = top; y <= bottom; y++) {
        const dark = gray[y * width + Math.max(0, x - 1)] < DARK_THRESHOLD || gray[y * width + x] < DARK_THRESHOLD || gray[y * width + Math.min(width - 1, x + 1)] < DARK_THRESHOLD;
        if (dark) {
          count++; run++; allowedGap = 0;
        } else if (run && allowedGap < 2) {
          run++; allowedGap++;
        } else {
          longestRun = Math.max(longestRun, run - allowedGap);
          run = 0; allowedGap = 0;
        }
      }
      longestRun = Math.max(longestRun, run - allowedGap);
      if (count >= minVerticalInk && longestRun >= (bottom - top) * 0.30) verticalCandidates.push(x);
    }
    const detectedVerticals = groupPositions(verticalCandidates, 4).filter(value => value >= left - 4 && value <= right + 4);
    const chooseColumn = (minimumFraction, maximumFraction, idealFraction, after = left) => {
      const candidates = detectedVerticals.filter(value => {
        const fraction = (value - left) / tableWidth;
        return fraction >= minimumFraction && fraction <= maximumFraction && value > after + tableWidth * 0.05;
      });
      if (!candidates.length) return Math.round(left + tableWidth * idealFraction);
      const nearest = candidates.reduce((best, value) => Math.abs((value - left) / tableWidth - idealFraction) < Math.abs((best - left) / tableWidth - idealFraction) ? value : best);
      return Math.abs((nearest - left) / tableWidth - idealFraction) <= 0.035 ? nearest : Math.round(left + tableWidth * idealFraction);
    };
    const numberRight = chooseColumn(0.035, 0.19, 0.095);
    const wordRight = chooseColumn(0.16, 0.48, 0.285, numberRight);
    const verticalLines = [left, numberRight, wordRight, right];
    if (verticalLines[1] - verticalLines[0] < 12 || verticalLines[2] - verticalLines[1] < 35) throw new Error("表の列を検出できませんでした");
    return { horizontalLines, verticalLines, lineEdges, left, right, top, bottom };
  }

  function columnsForRow(table, y1, y2) {
    const nearestEdge = y => table.lineEdges.reduce((best, edge) => Math.abs(edge.y - y) < Math.abs(best.y - y) ? edge : best);
    const topEdge = nearestEdge(y1);
    const bottomEdge = nearestEdge(y2);
    const localLeft = Math.round((topEdge.left + bottomEdge.left) / 2);
    const localRight = Math.round((topEdge.right + bottomEdge.right) / 2);
    const width = localRight - localLeft;
    const baseWidth = table.right - table.left;
    const firstFraction = (table.verticalLines[1] - table.left) / baseWidth;
    const secondFraction = (table.verticalLines[2] - table.left) / baseWidth;
    return [localLeft, Math.round(localLeft + width * firstFraction), Math.round(localLeft + width * secondFraction), localRight];
  }

  function otsuThreshold(gray) {
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
    return Math.max(120, Math.min(205, threshold + 18));
  }

  function preprocessCell(page, x1, y1, x2, y2, options = {}) {
    // The source sheet has heavy grid lines and only 8–12 px-high glyphs.
    // Crop well inside the cell, normalize contrast, then enlarge before OCR.
    const lineTrim = options.lineTrim || "normal";
    const trimSettings = lineTrim === "strong"
      ? { xRatio: 0.07, minX: 9, maxX: 14, yRatio: 0.17 }
      : lineTrim === "light"
        ? { xRatio: 0.035, minX: 4, maxX: 8, yRatio: 0.07 }
        : { xRatio: 0.05, minX: 7, maxX: 10, yRatio: 0.10 };
    const insetX = Math.max(trimSettings.minX, Math.min(trimSettings.maxX, Math.round((x2 - x1) * trimSettings.xRatio)));
    const insetY = Math.max(1, Math.round((y2 - y1) * trimSettings.yRatio));
    const cropped = cropCanvas(page, x1 + insetX, y1 + insetY, Math.max(2, x2 - x1 - insetX * 2), Math.max(2, y2 - y1 - insetY * 2));
    const context = cropped.getContext("2d", { willReadFrequently: true });
    const image = context.getImageData(0, 0, cropped.width, cropped.height);
    const gray = new Uint8Array(cropped.width * cropped.height);
    const histogram = new Uint32Array(256);
    for (let pixel = 0, index = 0; pixel < image.data.length; pixel += 4, index++) {
      gray[index] = Math.round(image.data[pixel] * 0.299 + image.data[pixel + 1] * 0.587 + image.data[pixel + 2] * 0.114);
      histogram[gray[index]]++;
    }
    const percentile = fraction => {
      const target = gray.length * fraction;
      let count = 0;
      for (let value = 0; value < 256; value++) {
        count += histogram[value];
        if (count >= target) return value;
      }
      return 255;
    };
    const low = percentile(options.lowPercentile ?? 0.01);
    const high = Math.max(low + 24, percentile(options.highPercentile ?? 0.995));
    const contrast = options.contrast ?? 1.12;
    const normalizeAmount = options.normalizeAmount ?? 1;
    for (let index = 0; index < gray.length; index++) {
      const stretched = Math.max(0, Math.min(255, Math.round((gray[index] - low) * 255 / (high - low))));
      const normalized = gray[index] * (1 - normalizeAmount) + stretched * normalizeAmount;
      const value = Math.max(0, Math.min(255, Math.round((normalized - 128) * contrast + 128)));
      image.data[index * 4] = value; image.data[index * 4 + 1] = value; image.data[index * 4 + 2] = value; image.data[index * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    const targetHeight = options.targetHeight ?? 160;
    const scale = Math.max(2, Math.min(options.maxScale ?? 18, targetHeight / cropped.height));
    const padding = options.padding ?? 14;
    const output = canvasFromSize(cropped.width * scale + padding * 2, cropped.height * scale + padding * 2);
    const outputContext = output.getContext("2d", { willReadFrequently: true });
    outputContext.fillStyle = "white";
    outputContext.fillRect(0, 0, output.width, output.height);
    outputContext.imageSmoothingEnabled = options.smoothing !== false;
    outputContext.imageSmoothingQuality = "high";
    outputContext.drawImage(cropped, padding, padding, cropped.width * scale, cropped.height * scale);
    if (options.threshold != null) {
      const outputImage = outputContext.getImageData(0, 0, output.width, output.height);
      const outputGray = new Uint8Array(output.width * output.height);
      for (let pixel = 0, index = 0; pixel < outputImage.data.length; pixel += 4, index++) outputGray[index] = outputImage.data[pixel];
      const threshold = options.threshold === "otsu" ? otsuThreshold(outputGray) : options.threshold;
      for (let pixel = 0; pixel < outputImage.data.length; pixel += 4) {
        const value = outputImage.data[pixel] < threshold ? 0 : 255;
        outputImage.data[pixel] = value; outputImage.data[pixel + 1] = value; outputImage.data[pixel + 2] = value;
      }
      outputContext.putImageData(outputImage, 0, 0);
    }
    return output;
  }

  function cellInkRatio(page, x1, y1, x2, y2) {
    const insetX = Math.max(3, Math.round((x2 - x1) * 0.08));
    const insetY = Math.max(2, Math.round((y2 - y1) * 0.16));
    const cell = cropCanvas(page, x1 + insetX, y1 + insetY, Math.max(2, x2 - x1 - insetX * 2), Math.max(2, y2 - y1 - insetY * 2));
    const gray = grayscalePixels(cell);
    let dark = 0;
    for (const value of gray) if (value < 178) dark++;
    return gray.length ? dark / gray.length : 0;
  }

  function makeRowPreview(page, x1, y1, x2, y2) {
    const row = cropCanvas(page, Math.max(0, x1 - 2), Math.max(0, y1 - 2), Math.min(page.width - x1 + 2, x2 - x1 + 4), Math.min(page.height - y1 + 2, y2 - y1 + 4));
    const targetHeight = Math.max(44, Math.min(88, row.height * 3));
    const scale = targetHeight / row.height;
    const preview = canvasFromSize(row.width * scale, targetHeight);
    const context = preview.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, preview.width, preview.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(row, 0, 0, preview.width, preview.height);
    return preview.toDataURL("image/jpeg", 0.76);
  }

  function cleanEnglish(text) {
    const matches = String(text || "").normalize("NFKC").match(/[A-Za-z][A-Za-z'’-]{1,40}/g);
    if (!matches?.length) return "";
    return matches.sort((a, b) => b.length - a.length)[0].replace(/’/g, "'").toLowerCase();
  }

  function clamp(value, minimum = 0, maximum = 100) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function comparableText(value, type) {
    const normalized = String(value || "").normalize("NFKC").toLocaleLowerCase(type === "word" ? "en" : "ja");
    return normalized.replace(/[\s　、。，．,.・･/／\\'"“”‘’「」『』()（）\[\]【】≪≫〈〉《》〔〕｛｝{}：:;；!?！？①-⑳]/g, "");
  }

  function editDistance(left, right) {
    if (left === right) return 0;
    if (!left.length) return right.length;
    if (!right.length) return left.length;
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
      const current = [leftIndex];
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
        current[rightIndex] = Math.min(
          current[rightIndex - 1] + 1,
          previous[rightIndex] + 1,
          previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
        );
      }
      previous = current;
    }
    return previous[right.length];
  }

  function textSimilarity(left, right, type) {
    const a = comparableText(left, type);
    const b = comparableText(right, type);
    if (!a || !b) return 0;
    if (type === "meaning") {
      const shorter = a.length <= b.length ? a : b;
      const longer = a.length > b.length ? a : b;
      if (longer.includes(shorter)) return shorter.length === 1 ? 0.68 : 0.82;
    }
    return 1 - editDistance(a, b) / Math.max(a.length, b.length);
  }

  function evaluateEnglish(result, variant) {
    const raw = String(result.data.text || "").normalize("NFKC").trim();
    const value = cleanEnglish(raw);
    const compact = raw.replace(/[\s　]/g, "");
    const invalidCount = [...compact].filter(char => !/[A-Za-z'’-]/.test(char)).length;
    const invalidRatio = compact.length ? invalidCount / compact.length : 1;
    const plausible = /^[a-z][a-z'’-]{1,30}$/i.test(value);
    const reasonableLength = value.length >= 2 && value.length <= 24;
    const hasVowel = value.length <= 3 || /[aeiouy]/i.test(value);
    const repeated = /(.)\1\1/i.test(value);
    const tokenCount = raw.split(/\s+/).filter(Boolean).length;
    let quality = (result.data.confidence || 0) * 0.62;
    quality += plausible ? 18 : -22;
    quality += invalidRatio <= 0.04 ? 8 : -Math.min(18, invalidRatio * 30);
    quality += reasonableLength ? 4 : -8;
    quality += hasVowel ? 4 : -7;
    quality += tokenCount <= 1 ? 4 : -6;
    if (repeated) quality -= 8;
    quality = clamp(quality);
    return {
      type: "word", raw, value, confidence: result.data.confidence || 0, quality,
      suspicious: !value || !plausible || invalidRatio > 0.08 || quality < 80 || (result.data.confidence || 0) < 82,
      variant: variant.name
    };
  }

  function evaluateJapanese(result, variant, analyzeMeaning) {
    const raw = String(result.data.text || "").trim();
    const normalizedRaw = raw.normalize("NFKC");
    const postprocess = analyzeMeaning(raw);
    const value = postprocess.meaning;
    const compact = normalizedRaw.replace(/[\s　]/g, "");
    const allowed = /[ぁ-んァ-ン一-龯々ゝゞーA-Za-z0-9①-⑳、。，．,.・･/／\\'"“”‘’「」『』()（）\[\]【】≪≫〈〉《》〔〕｛｝{}<>：:;；!?！？+%％-]/;
    const abnormalCount = [...compact].filter(char => !allowed.test(char)).length;
    const abnormalRatio = compact.length ? abnormalCount / compact.length : 1;
    const meaningful = comparableText(value, "meaning");
    const japaneseCount = [...meaningful].filter(char => /[ぁ-んァ-ン一-龯々ゝゞー]/.test(char)).length;
    const japaneseRatio = meaningful.length ? japaneseCount / meaningful.length : 0;
    const markers = [...raw.matchAll(/[①-⑳]/g)].map(match => match[0].codePointAt(0) - "①".codePointAt(0) + 1);
    const markerOrderBroken = markers.some((marker, index) => index > 0 && marker <= markers[index - 1]);
    const missingFirstMarker = markers.some(marker => marker >= 2) && !markers.includes(1);
    const mojibake = /[�□■◆◇_=~^`|]|\uFFFD/.test(normalizedRaw);
    const lineArtifact = /[ー一―‐-]{5,}|(.)\1{5,}/.test(normalizedRaw);
    const outsideParentheses = normalizedRaw.replace(/[（(][^）)]*[）)]/g, "");
    const mixedLatinOutsideContext = /[A-Za-z]/.test(outsideParentheses) && /[ぁ-んァ-ン一-龯々]/.test(outsideParentheses);
    const brokenLeadingMarker = /^[DＯO0)）]\s*(?=[ぁ-んァ-ン一-龯々])/.test(normalizedRaw);
    const bracketSource = brokenLeadingMarker ? normalizedRaw.replace(/^[DＯO0)）]\s*/, "") : normalizedRaw;
    const openingBrackets = (bracketSource.match(/[（(\[【「『≪〈《〔｛{<]/g) || []).length;
    const closingBrackets = (bracketSource.match(/[）)\]】」』≫〉》〕｝}>]/g) || []).length;
    const brokenBrackets = openingBrackets !== closingBrackets;
    const lengthOkay = meaningful.length >= 1 && meaningful.length <= 80;
    const lengthScore = meaningful.length >= 2 ? 16 : japaneseCount === 1 ? 6 : -18;
    let quality = (result.data.confidence || 0) * 0.54;
    quality += lengthOkay ? lengthScore : -18;
    quality += abnormalRatio <= 0.04 ? 10 : -Math.min(24, abnormalRatio * 45);
    quality += japaneseRatio >= 0.35 ? 10 : japaneseRatio >= 0.15 ? 3 : -10;
    quality += !markerOrderBroken && !missingFirstMarker ? 7 : -8;
    if (mojibake) quality -= 15;
    if (lineArtifact) quality -= 22;
    if (mixedLatinOutsideContext) quality -= 40;
    if (brokenLeadingMarker) quality -= 4;
    if (brokenBrackets) quality -= 12;
    quality = clamp(quality);
    return {
      type: "meaning", raw, value, confidence: result.data.confidence || 0, quality,
      suspicious: !value || !lengthOkay || abnormalRatio > 0.08 || mojibake || lineArtifact || mixedLatinOutsideContext || markerOrderBroken || missingFirstMarker || brokenBrackets || postprocess.uncertain || quality < 76 || (result.data.confidence || 0) < 72,
      variant: variant.name,
      postprocess
    };
  }

  function selectBestCandidate(candidates, type) {
    const valid = candidates.filter(candidate => candidate.value);
    if (!valid.length) return { candidate: candidates[0], reliability: 0, consistency: 0, unresolved: true, attempts: candidates.length };
    for (const candidate of valid) {
      const others = valid.filter(item => item !== candidate);
      const similarities = others.map(other => {
        const valueMatch = textSimilarity(candidate.value, other.value, type);
        if (type !== "meaning") return valueMatch;
        const rawMatch = textSimilarity(candidate.raw, other.raw, "meaning");
        return valueMatch * 0.68 + rawMatch * 0.32;
      });
      candidate.consistency = similarities.length ? Math.max(...similarities) : 1;
      candidate.rawConsistency = type === "meaning" && others.length
        ? Math.max(...others.map(other => textSimilarity(candidate.raw, other.raw, "meaning")))
        : candidate.consistency;
      candidate.exactSupport = others.filter(other => comparableText(other.value, type) === comparableText(candidate.value, type)).length;
      candidate.comparisonScore = candidate.quality + candidate.exactSupport * 12 + candidate.consistency * (type === "meaning" ? 14 : 9);
    }
    const ranked = [...valid].sort((left, right) => right.comparisonScore - left.comparisonScore || right.confidence - left.confidence);
    const candidate = ranked[0];
    const margin = ranked.length > 1 ? candidate.comparisonScore - ranked[1].comparisonScore : 100;
    const consistencyLimit = type === "word" ? 0.84 : 0.58;
    const stronglySupported = candidate.exactSupport > 0 || candidate.consistency >= consistencyLimit;
    const decisive = margin >= 13 && candidate.quality >= 82;
    const rawDisagreement = type === "meaning" && ranked.length > 1 && candidate.rawConsistency < 0.42;
    const unresolved = candidate.quality < (type === "word" ? 74 : 70) || rawDisagreement || (ranked.length > 1 && !stronglySupported && !decisive);
    const reliability = Math.round(clamp(candidate.quality * 0.82 + candidate.consistency * 18 - (unresolved ? 6 : 0)));
    return {
      candidate, reliability, consistency: candidate.consistency, unresolved, attempts: candidates.length,
      candidates: ranked.map(item => ({ raw: item.raw, value: item.value, confidence: item.confidence, quality: Math.round(item.quality), variant: item.variant }))
    };
  }

  function needsThirdAttempt(candidates, type) {
    const selected = selectBestCandidate(candidates, type);
    const distinct = new Set(candidates.map(candidate => comparableText(candidate.value, type)).filter(Boolean)).size;
    return selected.unresolved || distinct > 1 || selected.reliability < 82;
  }

  function mergeContinuationRows(rows, analyzeMeaning) {
    const merged = [];
    for (const row of rows) {
      const previous = merged[merged.length - 1];
      const samePage = previous?.pageInfo === row.pageInfo;
      const adjacent = previous && row.rowIndex === previous.rowIndex + (previous.continuationRows || 0) + 1;
      if (row.structuralContinuation && samePage && adjacent && previous.front) {
        previous.rawMeaning = [previous.rawMeaning, row.rawMeaning].filter(Boolean).join("\n");
        previous.meaningPostprocess = analyzeMeaning(previous.rawMeaning);
        previous.back = previous.meaningPostprocess.meaning;
        previous.meaningConfidence = Math.min(previous.meaningConfidence || 0, row.meaningConfidence || 0);
        previous.meaningValidation = {
          ...previous.meaningValidation,
          reliability: previous.meaningConfidence,
          unresolved: Boolean(previous.meaningValidation?.unresolved || row.meaningValidation?.unresolved),
          attempts: (previous.meaningValidation?.attempts || 0) + (row.meaningValidation?.attempts || 0)
        };
        previous.sourceY2 = row.sourceY2;
        previous.continuationRows = (previous.continuationRows || 0) + 1;
        previous.continuationUncertain = Boolean(previous.continuationUncertain || row.continuationUncertain);
        continue;
      }
      merged.push(row);
    }
    return merged;
  }

  async function extract(files, options = {}) {
    const onProgress = options.onProgress || (() => {});
    const cleanMeaning = options.cleanMeaning || (value => String(value || "").trim());
    const analyzeMeaning = options.analyzeMeaning || (value => ({ raw: String(value || "").trim(), meaning: cleanMeaning(value), uncertain: false, reasons: [] }));
    const sourcePages = [];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      onProgress({ stage: "prepare", message: (fileIndex + 1) + " / " + files.length + " 個目の画像・PDFを準備中…" });
      const filePages = await loadSourcePages(files[fileIndex], onProgress);
      filePages.forEach((source, pdfPageIndex) => {
        const deskewed = window.OcrImageProcessing?.deskewCanvas(source) || { canvas: source, angle: 0, confidence: 0 };
        splitPages(deskewed.canvas).forEach((page, spreadIndex) => sourcePages.push({
          page, fileIndex, pdfPageIndex, spreadIndex,
          pageIndex: sourcePages.length,
          deskewAngle: deskewed.angle
        }));
      });
    }
    const descriptors = [];
    for (let pageNumber = 0; pageNumber < sourcePages.length; pageNumber++) {
      const pageInfo = sourcePages[pageNumber];
      onProgress({ stage: "detect", message: (pageNumber + 1) + " / " + sourcePages.length + " ページ目の表と罫線を検出中…" });
      const table = findTable(pageInfo.page);
      const rowHeights = [];
      for (let rowIndex = 0; rowIndex < table.horizontalLines.length - 1; rowIndex++) {
        const height = table.horizontalLines[rowIndex + 1] - table.horizontalLines[rowIndex];
        if (height >= MIN_ROW_HEIGHT) rowHeights.push(height);
      }
      const typicalRowHeight = [...rowHeights].sort((left, right) => left - right)[Math.floor(rowHeights.length / 2)] || MIN_ROW_HEIGHT;
      for (let rowIndex = 0; rowIndex < table.horizontalLines.length - 1; rowIndex++) {
        const y1 = table.horizontalLines[rowIndex];
        const y2 = table.horizontalLines[rowIndex + 1];
        if (y2 - y1 < MIN_ROW_HEIGHT) continue;
        const columns = columnsForRow(table, y1, y2);
        const noInk = cellInkRatio(pageInfo.page, columns[0], y1, columns[1], y2);
        const wordInk = cellInkRatio(pageInfo.page, columns[1], y1, columns[2], y2);
        const meaningInk = cellInkRatio(pageInfo.page, columns[2], y1, columns[3], y2);
        const noAndWordBlank = noInk < 0.012 && wordInk < 0.012;
        const continuationStrength = Math.max(0, Math.min(1, (meaningInk - Math.max(noInk, wordInk)) / 0.025));
        descriptors.push({
          pageInfo, rowIndex, y1, y2, sourceY1: y1, sourceY2: y2, columns,
          regionIndex: Math.floor(rowIndex / 25),
          isTall: y2 - y1 >= typicalRowHeight * 1.30,
          structuralContinuation: noAndWordBlank && meaningInk >= 0.012,
          continuationUncertain: noAndWordBlank && meaningInk >= 0.012 && continuationStrength < 0.35,
          ink: { no: noInk, word: wordInk, meaning: meaningInk }
        });
      }
    }
    if (!descriptors.length) throw new Error("単語の行を検出できませんでした");

    const engineLogger = language => message => {
      if (["loading tesseract core", "loading language traineddata", "initializing api"].includes(message.status)) {
        onProgress({ stage: "engine", message: language + "OCRエンジンを準備中… " + Math.round((message.progress || 0) * 100) + "%" });
      }
    };
    const psm = window.Tesseract.PSM;
    const wordVariants = [
      { name: "英語・細線保持4倍", psm: psm.SINGLE_WORD, preprocess: { scale: 4, contrast: 1.02, normalizeAmount: 0.12, lineTrim: "light", insetXRatio: 0.015, insetYRatio: 0.12, minimumInsetX: 2, padding: 18, smoothing: true, sharpen: 0.10, lineRemoval: 0.10 } },
      { name: "英語・高解像5倍", psm: psm.SINGLE_WORD, preprocess: { scale: 5, contrast: 1.10, normalizeAmount: 0.42, lineTrim: "light", insetXRatio: 0.015, insetYRatio: 0.12, minimumInsetX: 2, padding: 20, smoothing: true, sharpen: 0.20, lineRemoval: 0.25 } },
      { name: "英語・二値化5倍", psm: psm.SINGLE_LINE, preprocess: { scale: 5, contrast: 1.10, normalizeAmount: 0.35, threshold: "otsu", thresholdOffset: 2, lineTrim: "light", insetXRatio: 0.012, insetYRatio: 0.11, minimumInsetX: 2, padding: 20, smoothing: false, sharpen: 0.12, lineRemoval: 0.42 } }
    ];
    const meaningVariants = [
      {
        name: "日本語・細線保持4倍", singlePsm: psm.SINGLE_LINE, multiPsm: psm.SINGLE_BLOCK,
        preprocess: { scale: 4, contrast: 1.00, normalizeAmount: 0, lowPercentile: 0.003, highPercentile: 0.9995, lineTrim: "light", insetXRatio: 0.008, insetYRatio: 0.12, minimumInsetX: 2, padding: 20, smoothing: true, sharpen: 0.80, lineRemoval: 0 }
      },
      {
        name: "日本語・高解像5倍", singlePsm: psm.RAW_LINE || psm.SINGLE_LINE, multiPsm: psm.SINGLE_BLOCK,
        preprocess: { scale: 5, contrast: 1.12, normalizeAmount: 0.52, lowPercentile: 0.006, highPercentile: 0.999, lineTrim: "light", insetXRatio: 0.008, insetYRatio: 0.13, minimumInsetX: 2, padding: 24, smoothing: true, denoise: true, sharpen: 0.22, lineRemoval: 0.28 }
      },
      {
        name: "日本語・原画優先3倍", singlePsm: psm.SINGLE_LINE, multiPsm: psm.SPARSE_TEXT || psm.SINGLE_BLOCK,
        preprocess: { scale: 3, contrast: 1.02, normalizeAmount: 0.12, lowPercentile: 0.001, highPercentile: 0.9998, lineTrim: "none", insetXRatio: 0.004, insetYRatio: 0.10, minimumInsetX: 1, padding: 20, smoothing: true, sharpen: 0.08, lineRemoval: 0 }
      },
      {
        name: "日本語・固定閾値二値化", singlePsm: psm.SINGLE_LINE, multiPsm: psm.SINGLE_BLOCK,
        preprocess: { scale: 5, contrast: 1.00, normalizeAmount: 1, lowPercentile: 0.008, highPercentile: 0.995, lineTrim: "light", insetXRatio: 0.008, insetYRatio: 0.12, minimumInsetX: 2, padding: 24, smoothing: true, sharpen: 0.80, lineRemoval: 0, threshold: 185 }
      },
      {
        name: "日本語・罫線除去自動二値化", singlePsm: psm.SINGLE_LINE, multiPsm: psm.SINGLE_BLOCK,
        preprocess: { scale: 5, contrast: 1.10, normalizeAmount: 0.38, lineTrim: "light", insetXRatio: 0.008, insetYRatio: 0.13, minimumInsetX: 2, padding: 24, smoothing: false, denoise: true, sharpen: 0.16, lineRemoval: 0.55, threshold: "otsu", thresholdOffset: 4 }
      }
    ];
    let wordWorker;
    try {
      onProgress({ stage: "engine", message: "英単語OCRエンジンを準備中…" });
      wordWorker = await window.Tesseract.createWorker("eng", 1, { logger: engineLogger("英単語"), langPath: "./", gzip: false });
      await wordWorker.setParameters({ user_defined_dpi: "300", tessedit_char_whitelist: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'-" });
      for (let index = 0; index < descriptors.length; index++) {
        const row = descriptors[index];
        if (row.structuralContinuation) {
          row.front = "";
          row.wordConfidence = 100;
          row.wordValidation = { candidate: { value: "" }, reliability: 100, unresolved: false, attempts: 0 };
          continue;
        }
        onProgress({ stage: "recognize", message: "英単語を読み取り中… " + (index + 1) + " / " + descriptors.length + " 行" });
        const { page } = row.pageInfo;
        const candidates = [];
        const recognize = async variant => {
          await wordWorker.setParameters({ tessedit_pageseg_mode: variant.psm });
          const prepared = window.OcrImageProcessing?.prepareCell
            ? window.OcrImageProcessing.prepareCell(page, row.columns[1], row.y1, row.columns[2], row.y2, variant.preprocess)
            : preprocessCell(page, row.columns[1], row.y1, row.columns[2], row.y2, variant.preprocess);
          const result = await wordWorker.recognize(prepared);
          candidates.push(evaluateEnglish(result, variant));
        };
        await recognize(wordVariants[0]);
        if (candidates[0].suspicious) {
          onProgress({ stage: "retry", message: "英単語を条件変更して再読み取り中… " + (index + 1) + " / " + descriptors.length + " 行" });
          await recognize(wordVariants[1]);
          if (needsThirdAttempt(candidates, "word")) await recognize(wordVariants[2]);
        }
        row.wordValidation = selectBestCandidate(candidates, "word");
        row.front = row.wordValidation.candidate?.value || "";
        row.wordConfidence = row.wordValidation.reliability;
      }
    } finally {
      if (wordWorker) await wordWorker.terminate();
    }

    let meaningWorker;
    try {
      onProgress({ stage: "engine", message: "日本語OCRエンジンを準備中…" });
      meaningWorker = await window.Tesseract.createWorker(["jpn", "eng"], 1, { logger: engineLogger("日本語"), langPath: "./", gzip: false });
      await meaningWorker.setParameters({ user_defined_dpi: "350", preserve_interword_spaces: "1" });
      for (let index = 0; index < descriptors.length; index++) {
        const row = descriptors[index];
        onProgress({ stage: "recognize", message: "日本語の意味を読み取り中… " + (index + 1) + " / " + descriptors.length + " 行" });
        const { page } = row.pageInfo;
        const candidates = [];
        const recognize = async variant => {
          await meaningWorker.setParameters({ tessedit_pageseg_mode: row.isTall ? variant.multiPsm : variant.singlePsm });
          const prepared = window.OcrImageProcessing?.prepareCell
            ? window.OcrImageProcessing.prepareCell(page, row.columns[2], row.y1, row.columns[3], row.y2, variant.preprocess)
            : preprocessCell(page, row.columns[2], row.y1, row.columns[3], row.y2, variant.preprocess);
          const result = await meaningWorker.recognize(prepared);
          candidates.push(evaluateJapanese(result, variant, analyzeMeaning));
        };
        await recognize(meaningVariants[0]);
        if (candidates[0].suspicious) {
          onProgress({ stage: "retry", message: "日本語の意味を条件変更して再読み取り中… " + (index + 1) + " / " + descriptors.length + " 行" });
          await recognize(meaningVariants[1]);
          if (needsThirdAttempt(candidates, "meaning")) await recognize(meaningVariants[2]);
          if (needsThirdAttempt(candidates, "meaning")) await recognize(meaningVariants[3]);
          if (needsThirdAttempt(candidates, "meaning")) await recognize(meaningVariants[4]);
        }
        row.meaningValidation = selectBestCandidate(candidates, "meaning");
        row.rawMeaning = row.meaningValidation.candidate?.raw || "";
        row.back = row.meaningValidation.candidate?.value || "";
        row.meaningPostprocess = row.meaningValidation.candidate?.postprocess || analyzeMeaning(row.rawMeaning);
        row.meaningConfidence = row.meaningValidation.reliability;
      }
    } finally {
      if (meaningWorker) await meaningWorker.terminate();
    }

    const mergedDescriptors = mergeContinuationRows(descriptors, analyzeMeaning);

    return mergedDescriptors.flatMap(row => {
      const header = /^(word|headword)$/i.test(row.front) || /見出し語|意味/.test(row.rawMeaning);
      if (header) return [];
      const confidence = Math.round(Math.min(row.wordConfidence || 0, row.meaningConfidence || 0));
      const plausibleWord = /^[a-z][a-z'’-]{1,30}$/i.test(row.front);
      const reviewReasons = [];
      if (!row.front || !row.back) reviewReasons.push("未読取の欄あり");
      if (row.front && !plausibleWord) reviewReasons.push("見出し語の形式");
      if (row.wordValidation?.unresolved) reviewReasons.push("英単語を再読取しても候補が不一致");
      if (row.meaningValidation?.unresolved) reviewReasons.push("日本語を再読取しても判定困難");
      if (row.meaningPostprocess?.uncertain) reviewReasons.push(...row.meaningPostprocess.reasons);
      if (row.continuationUncertain) reviewReasons.push("2行にまたがる意味の結合を確認してください");
      if (confidence < 70) reviewReasons.push("自動検証後も信頼度が低い");
      return [{
        front: row.front,
        rawMeaning: row.rawMeaning,
        back: row.back,
        confidence,
        needsReview: reviewReasons.length > 0,
        status: reviewReasons.length > 0 ? "needs_review" : "ocr_ok",
        reviewReason: reviewReasons.join("・"),
        validationSummary: "英" + (row.wordValidation?.attempts || 1) + "回／日" + (row.meaningValidation?.attempts || 1) + "回で自動比較（" + (row.meaningValidation?.candidate?.variant || "標準") + "採用）",
        ...(options.includeDebugCandidates ? { ocrCandidates: row.meaningValidation?.candidates || [] } : {}),
        sourceImage: makeRowPreview(row.pageInfo.page, row.columns[0], row.sourceY1, row.columns[3], row.sourceY2),
        source: (row.pageInfo.fileIndex + 1) + "個目・PDF/画像" + (row.pageInfo.pdfPageIndex + 1) + "ページ・表" + (row.pageInfo.spreadIndex + 1) + "・" + (row.rowIndex + 1) + "行" + (row.continuationRows ? "から" + (row.rowIndex + row.continuationRows + 1) + "行" : "")
      }];
    });
  }

  async function inspectLayout(file) {
    const sourcePages = await loadSourcePages(file, () => {});
    return sourcePages.flatMap((source, pdfPageIndex) => {
      const deskewed = window.OcrImageProcessing?.deskewCanvas(source) || { canvas: source, angle: 0 };
      return splitPages(deskewed.canvas).map((page, spreadIndex) => {
        const table = findTable(page);
        return {
          pdfPageIndex,
          spreadIndex,
          deskewAngle: deskewed.angle,
          size: [page.width, page.height],
          verticalLines: table.verticalLines,
          horizontalLines: table.horizontalLines,
          firstRows: table.horizontalLines.slice(0, 5).map((y1, index) => index < table.horizontalLines.length - 1
            ? columnsForRow(table, y1, table.horizontalLines[index + 1])
            : null).filter(Boolean),
        };
      });
    });
  }

  window.TableOcr = { extract, inspectLayout };
})();
