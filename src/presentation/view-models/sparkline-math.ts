export interface RawSparklineInput {
  value: number;
  timestamp?: string;
  label?: string;
}

export type SparklineDataInput = number | RawSparklineInput;

export interface SparklinePoint {
  index: number;
  value: number;
  x: number;
  y: number;
  timestamp?: string;
  label?: string;
}

export interface SparklineLayoutOptions {
  width?: number;
  height?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  minRange?: number; // Minimum vertical range to avoid flat line division by zero
  smooth?: boolean; // Smooth bezier curve vs linear segments
}

export interface SparklineMetrics {
  count: number;
  min: number;
  max: number;
  avg: number;
  latest: number;
  deltaPercent: number; // change from first to last point
  trend: 'UP' | 'DOWN' | 'STABLE';
}

export interface SparklineResult {
  points: SparklinePoint[];
  linePath: string;
  areaPath: string;
  metrics: SparklineMetrics;
  width: number;
  height: number;
  viewBox: string;
}

/**
 * Normaliza cualquier entrada de datos (array de números u objetos)
 * a un array estándar de { value, timestamp, label }.
 */
export function normalizeSparklineData(data: SparklineDataInput[]): RawSparklineInput[] {
  if (!Array.isArray(data)) return [];

  return data.map((item, idx) => {
    if (typeof item === 'number') {
      return {
        value: Number.isFinite(item) ? Math.max(0, item) : 0,
        label: `Muestra #${idx + 1}`,
      };
    }
    return {
      value: Number.isFinite(item.value) ? Math.max(0, item.value) : 0,
      timestamp: item.timestamp,
      label: item.label ?? `Muestra #${idx + 1}`,
    };
  });
}

/**
 * Calcula las métricas estadísticas clave del conjunto de datos de latencia.
 */
export function calculateSparklineMetrics(data: RawSparklineInput[]): SparklineMetrics {
  if (data.length === 0) {
    return {
      count: 0,
      min: 0,
      max: 0,
      avg: 0,
      latest: 0,
      deltaPercent: 0,
      trend: 'STABLE',
    };
  }

  const values = data.map((d) => d.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sum = values.reduce((acc, v) => acc + v, 0);
  const avg = Math.round((sum / values.length) * 10) / 10;
  const latest = values[values.length - 1] ?? 0;
  const first = values[0] ?? 0;

  let deltaPercent = 0;
  if (first > 0) {
    deltaPercent = Math.round(((latest - first) / first) * 1000) / 10;
  }

  let trend: 'UP' | 'DOWN' | 'STABLE' = 'STABLE';
  if (deltaPercent > 5) trend = 'UP';
  else if (deltaPercent < -5) trend = 'DOWN';

  return {
    count: values.length,
    min,
    max,
    avg,
    latest,
    deltaPercent,
    trend,
  };
}

/**
 * Genera la geometría SVG (coordenadas escaladas, path de línea y path de área con gradiente).
 */
export function calculateSparkline(
  rawInput: SparklineDataInput[],
  options: SparklineLayoutOptions = {}
): SparklineResult {
  const {
    width = 300,
    height = 60,
    paddingTop = 6,
    paddingRight = 6,
    paddingBottom = 6,
    paddingLeft = 6,
    minRange = 5,
    smooth = true,
  } = options;

  const data = normalizeSparklineData(rawInput);
  const metrics = calculateSparklineMetrics(data);

  const innerWidth = Math.max(10, width - paddingLeft - paddingRight);
  const innerHeight = Math.max(10, height - paddingTop - paddingBottom);
  const viewBox = `0 0 ${width} ${height}`;

  if (data.length === 0) {
    return {
      points: [],
      linePath: '',
      areaPath: '',
      metrics,
      width,
      height,
      viewBox,
    };
  }

  if (data.length === 1) {
    const single = data[0]!;
    const singleY = paddingTop + innerHeight / 2;
    const p: SparklinePoint = {
      index: 0,
      value: single.value,
      x: paddingLeft + innerWidth / 2,
      y: singleY,
      timestamp: single.timestamp,
      label: single.label,
    };
    return {
      points: [p],
      linePath: `M ${paddingLeft} ${singleY} L ${paddingLeft + innerWidth} ${singleY}`,
      areaPath: `M ${paddingLeft} ${singleY} L ${paddingLeft + innerWidth} ${singleY} L ${paddingLeft + innerWidth} ${height - paddingBottom} L ${paddingLeft} ${height - paddingBottom} Z`,
      metrics,
      width,
      height,
      viewBox,
    };
  }

  const minVal = metrics.min;
  const maxVal = Math.max(metrics.max, minVal + minRange);
  const range = maxVal - minVal;

  const points: SparklinePoint[] = data.map((item, idx) => {
    const x = paddingLeft + (idx / (data.length - 1)) * innerWidth;
    const norm = (item.value - minVal) / range;
    const y = paddingTop + innerHeight - norm * innerHeight;
    return {
      index: idx,
      value: item.value,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      timestamp: item.timestamp,
      label: item.label,
    };
  });

  // Construir SVG path
  let linePath = '';
  if (!smooth || points.length < 3) {
    linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  } else {
    const firstP = points[0]!;
    linePath = `M ${firstP.x} ${firstP.y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i === 0 ? 0 : i - 1] ?? firstP;
      const p1 = points[i] ?? firstP;
      const p2 = points[i + 1] ?? firstP;
      const p3 = points[i + 2 < points.length ? i + 2 : points.length - 1] ?? p2;

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      linePath += ` C ${Math.round(cp1x * 10) / 10} ${Math.round(cp1y * 10) / 10}, ${Math.round(cp2x * 10) / 10} ${Math.round(cp2y * 10) / 10}, ${p2.x} ${p2.y}`;
    }
  }

  const baselineY = height - paddingBottom;
  const firstX = points[0]?.x ?? paddingLeft;
  const lastX = points[points.length - 1]?.x ?? (paddingLeft + innerWidth);
  const areaPath = `${linePath} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;

  return {
    points,
    linePath,
    areaPath,
    metrics,
    width,
    height,
    viewBox,
  };
}

/**
 * Formatea el texto de tooltip en milisegundos con contexto temporal o comparativo.
 */
export function formatSparklineTooltip(
  point: SparklinePoint,
  avg?: number
): { primary: string; secondary: string; deltaText?: string } {
  const primary = `${point.value.toFixed(1)} ms`;
  let secondary = point.label ?? `Muestra #${point.index + 1}`;

  if (point.timestamp) {
    try {
      const d = new Date(point.timestamp);
      secondary = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      // Keep label
    }
  }

  let deltaText: string | undefined;
  if (avg !== undefined && avg > 0) {
    const diff = point.value - avg;
    const sign = diff >= 0 ? '+' : '';
    deltaText = `${sign}${diff.toFixed(1)} ms vs prom`;
  }

  return { primary, secondary, deltaText };
}
