/**
 * Motor de Layout Dinámico para Zonas de Empresa
 * 
 * Genera distribución automática de zonas en el espacio 3D
 * basado en mejores prácticas 2026:
 * - Zona común central (hub de colaboración)
 * - Empresas distribuidas radialmente alrededor del centro
 * - Gap entre zonas (pasillos/corredores)
 * - Tamaño proporcional al número de miembros
 * - Paleta de colores curada para N empresas
 * - Escalable para cualquier cantidad de empresas
 * 
 * Inspirado en: Gather.town (zonas por equipo + área común),
 * Smart Zoning 2026 (Deep Work + Collaboration Hubs),
 * Layouts radiales con optimización espacial.
 */

// ===== Tipos =====

export interface EmpresaParaLayout {
  id: string;
  nombre: string;
  miembros_count: number;
  color_preferido?: string | null;
  logo_url?: string | null;
}

export interface ZonaGenerada {
  empresa_id: string | null;
  nombre_zona: string;
  posicion_x: number;
  posicion_y: number;
  ancho: number;
  alto: number;
  color: string;
  es_comun: boolean;
  spawn_x: number;
  spawn_y: number;
}

export interface LayoutConfig {
  /** Tamaño total del mundo en unidades de pixel (default 800) */
  worldSize?: number;
  /** Tamaño mínimo de zona en px (default 120) */
  zonaSizeMin?: number;
  /** Tamaño máximo de zona en px (default 320) */
  zonaSizeMax?: number;
  /** Tamaño de la zona común central (default auto) */
  zonaComúnSize?: number;
  /** Gap entre zonas en px (pasillos) (default 24) */
  gap?: number;
  /** Incluir zona común central (default true) */
  incluirZonaComun?: boolean;
  /** Algoritmo de distribución */
  algoritmo?: 'radial' | 'grid' | 'organico';
}

export interface LayoutResult {
  zonas: ZonaGenerada[];
  worldSizeUsado: number;
  algoritmoUsado: string;
}

// ===== Paleta de Colores 2026 =====
// Colores vibrantes pero profesionales, alta diferenciación visual
const PALETA_COLORES: string[] = [
  '#6366f1', // indigo
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#14b8a6', // teal
  '#f97316', // orange
  '#84cc16', // lime
  '#a855f7', // purple
  '#0ea5e9', // sky
  '#e11d48', // rose
  '#22d3ee', // light cyan
  '#facc15', // yellow
  '#4ade80', // green light
  '#c084fc', // purple light
  '#fb923c', // orange light
  '#2dd4bf', // teal light
  '#818cf8', // indigo light
];

const COLOR_ZONA_COMUN = '#3b82f6'; // blue-500

// ===== Utilidades =====

function asignarColor(index: number, empresaColor?: string | null): string {
  if (empresaColor && empresaColor.startsWith('#')) return empresaColor;
  return PALETA_COLORES[index % PALETA_COLORES.length];
}

function calcularTamanoZona(
  miembrosCount: number,
  totalMiembros: number,
  nEmpresas: number,
  config: Required<LayoutConfig>
): { ancho: number; alto: number } {
  if (totalMiembros === 0 || nEmpresas === 0) {
    const size = (config.zonaSizeMin + config.zonaSizeMax) / 2;
    return { ancho: size, alto: size };
  }

  // Base: distribución equitativa con bonus por miembros
  const baseSize = config.zonaSizeMin;
  const rangoExtra = config.zonaSizeMax - config.zonaSizeMin;

  // Proporción de miembros (normalizada), con un piso de 0.3 para que zonas pequeñas no sean invisibles
  const proporcion = Math.max(0.3, miembrosCount / Math.max(1, totalMiembros / nEmpresas));
  const proporcionClamp = Math.min(1, proporcion);

  const size = Math.round(baseSize + rangoExtra * proporcionClamp);
  // Ligera variación para que no sean todas cuadradas perfectas
  const ratio = 0.85 + Math.random() * 0.3; // entre 0.85 y 1.15
  return {
    ancho: Math.round(size * Math.min(ratio, 1.15)),
    alto: Math.round(size / Math.min(ratio, 1.15)),
  };
}

// ===== Algoritmo Radial =====
// Zona común en el centro, empresas en anillo(s) alrededor

function layoutRadial(
  empresas: EmpresaParaLayout[],
  config: Required<LayoutConfig>
): ZonaGenerada[] {
  const zonas: ZonaGenerada[] = [];
  const n = empresas.length;
  const centro = config.worldSize / 2;
  const totalMiembros = empresas.reduce((sum, e) => sum + e.miembros_count, 0);

  // Zona común central
  if (config.incluirZonaComun) {
    const comunSize = config.zonaComúnSize || Math.round(config.worldSize * 0.18);
    zonas.push({
      empresa_id: null,
      nombre_zona: 'Zona Común',
      posicion_x: centro,
      posicion_y: centro,
      ancho: comunSize,
      alto: comunSize,
      color: COLOR_ZONA_COMUN,
      es_comun: true,
      spawn_x: centro,
      spawn_y: centro,
    });
  }

  if (n === 0) return zonas;

  // Calcular tamaños de cada empresa
  const tamanos = empresas.map((empresa) =>
    calcularTamanoZona(empresa.miembros_count, totalMiembros, n, config)
  );

  // Radio del anillo: suficiente para que todas quepan sin overlap
  const maxZonaSize = Math.max(...tamanos.map((t) => Math.max(t.ancho, t.alto)));
  const zonaComúnRadius = config.incluirZonaComun
    ? (config.zonaComúnSize || config.worldSize * 0.18) / 2
    : 0;

  // Para N empresas, distribuir en uno o más anillos
  const empresasPorAnillo = Math.max(4, Math.min(8, n)); // 4-8 empresas por anillo
  const numAnillos = Math.ceil(n / empresasPorAnillo);

  let empresaIndex = 0;

  for (let anillo = 0; anillo < numAnillos; anillo++) {
    const empresasEnEsteAnillo = Math.min(empresasPorAnillo, n - empresaIndex);

    // Circunferencia necesaria = sum de (ancho de zona + gap) para este anillo
    let circunferenciaNecesaria = 0;
    for (let i = 0; i < empresasEnEsteAnillo; i++) {
      const idx = empresaIndex + i;
      circunferenciaNecesaria += Math.max(tamanos[idx].ancho, tamanos[idx].alto) + config.gap;
    }

    // Radio mínimo para que quepan
    const radioMinCircunferencia = circunferenciaNecesaria / (2 * Math.PI);
    const radioBaseAnillo = zonaComúnRadius + maxZonaSize / 2 + config.gap + anillo * (maxZonaSize + config.gap);
    const radioAnillo = Math.max(radioBaseAnillo, radioMinCircunferencia);

    // Distribuir angularmente con espaciado proporcional al tamaño
    let anguloAcumulado = -Math.PI / 2; // empezar arriba
    const circunferenciaReal = 2 * Math.PI * radioAnillo;

    for (let i = 0; i < empresasEnEsteAnillo; i++) {
      const idx = empresaIndex + i;
      const empresa = empresas[idx];
      const tamano = tamanos[idx];

      // Ángulo proporcional al tamaño de la zona
      const anchoAngular = (Math.max(tamano.ancho, tamano.alto) + config.gap) / circunferenciaReal * (2 * Math.PI);
      const angulo = anguloAcumulado + anchoAngular / 2;

      const posX = Math.round(centro + radioAnillo * Math.cos(angulo));
      const posY = Math.round(centro + radioAnillo * Math.sin(angulo));

      zonas.push({
        empresa_id: empresa.id,
        nombre_zona: empresa.nombre,
        posicion_x: posX,
        posicion_y: posY,
        ancho: tamano.ancho,
        alto: tamano.alto,
        color: asignarColor(idx, empresa.color_preferido),
        es_comun: false,
        spawn_x: posX,
        spawn_y: posY,
      });

      anguloAcumulado += anchoAngular;
    }

    empresaIndex += empresasEnEsteAnillo;
  }

  return zonas;
}

// ===== Algoritmo Grid =====
// Disposición en cuadrícula ordenada con zona común en esquina/centro

function layoutGrid(
  empresas: EmpresaParaLayout[],
  config: Required<LayoutConfig>
): ZonaGenerada[] {
  const zonas: ZonaGenerada[] = [];
  const n = empresas.length;
  const totalMiembros = empresas.reduce((sum, e) => sum + e.miembros_count, 0);

  // Calcular grid: cuántas columnas/filas
  // +1 si incluye zona común
  const totalCeldas = n + (config.incluirZonaComun ? 1 : 0);
  const cols = Math.ceil(Math.sqrt(totalCeldas));
  const rows = Math.ceil(totalCeldas / cols);

  // Tamaño uniforme de celda
  const celdaAncho = Math.floor((config.worldSize - config.gap * (cols + 1)) / cols);
  const celdaAlto = Math.floor((config.worldSize - config.gap * (rows + 1)) / rows);
  const celdaSize = Math.min(celdaAncho, celdaAlto, config.zonaSizeMax);

  // Offset para centrar la grid en el mundo
  const gridAncho = cols * celdaSize + (cols - 1) * config.gap;
  const gridAlto = rows * celdaSize + (rows - 1) * config.gap;
  const offsetX = Math.round((config.worldSize - gridAncho) / 2 + celdaSize / 2);
  const offsetY = Math.round((config.worldSize - gridAlto) / 2 + celdaSize / 2);

  let celda = 0;

  // Zona común en la primera celda (centro lógico)
  if (config.incluirZonaComun) {
    const celdaCentro = Math.floor(totalCeldas / 2);
    const row = Math.floor(celdaCentro / cols);
    const col = celdaCentro % cols;
    const posX = offsetX + col * (celdaSize + config.gap);
    const posY = offsetY + row * (celdaSize + config.gap);

    zonas.push({
      empresa_id: null,
      nombre_zona: 'Zona Común',
      posicion_x: posX,
      posicion_y: posY,
      ancho: celdaSize,
      alto: celdaSize,
      color: COLOR_ZONA_COMUN,
      es_comun: true,
      spawn_x: posX,
      spawn_y: posY,
    });
  }

  // Empresas en las celdas restantes
  const celdaCentro = config.incluirZonaComun ? Math.floor(totalCeldas / 2) : -1;
  let empresaIdx = 0;

  for (let i = 0; i < totalCeldas && empresaIdx < n; i++) {
    if (i === celdaCentro) continue;

    const row = Math.floor(i / cols);
    const col = i % cols;
    const empresa = empresas[empresaIdx];

    // Tamaño proporcional a miembros (dentro de la celda)
    const tamano = calcularTamanoZona(empresa.miembros_count, totalMiembros, n, {
      ...config,
      zonaSizeMax: celdaSize,
      zonaSizeMin: Math.round(celdaSize * 0.7),
    });

    const posX = offsetX + col * (celdaSize + config.gap);
    const posY = offsetY + row * (celdaSize + config.gap);

    zonas.push({
      empresa_id: empresa.id,
      nombre_zona: empresa.nombre,
      posicion_x: posX,
      posicion_y: posY,
      ancho: tamano.ancho,
      alto: tamano.alto,
      color: asignarColor(empresaIdx, empresa.color_preferido),
      es_comun: false,
      spawn_x: posX,
      spawn_y: posY,
    });

    empresaIdx++;
  }

  return zonas;
}

// ===== Algoritmo Orgánico =====
// Espiral logarítmica desde el centro — las empresas más grandes más cerca

function layoutOrganico(
  empresas: EmpresaParaLayout[],
  config: Required<LayoutConfig>
): ZonaGenerada[] {
  const zonas: ZonaGenerada[] = [];
  const centro = config.worldSize / 2;
  const totalMiembros = empresas.reduce((sum, e) => sum + e.miembros_count, 0);

  // Ordenar por miembros desc (las más grandes más cerca del centro)
  const empresasOrdenadas = [...empresas].sort((a, b) => b.miembros_count - a.miembros_count);
  const n = empresasOrdenadas.length;

  // Zona común
  if (config.incluirZonaComun) {
    const comunSize = config.zonaComúnSize || Math.round(config.worldSize * 0.15);
    zonas.push({
      empresa_id: null,
      nombre_zona: 'Zona Común',
      posicion_x: centro,
      posicion_y: centro,
      ancho: comunSize,
      alto: comunSize,
      color: COLOR_ZONA_COMUN,
      es_comun: true,
      spawn_x: centro,
      spawn_y: centro,
    });
  }

  if (n === 0) return zonas;

  // Espiral de Fermat: r = a * sqrt(n), theta = golden_angle * n
  const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ~137.5°
  const zonaComúnRadius = config.incluirZonaComun
    ? (config.zonaComúnSize || config.worldSize * 0.15) / 2
    : 0;
  const spacingFactor = Math.max(config.zonaSizeMin, config.zonaSizeMax * 0.6) + config.gap;

  for (let i = 0; i < n; i++) {
    const empresa = empresasOrdenadas[i];
    const tamano = calcularTamanoZona(empresa.miembros_count, totalMiembros, n, config);

    // Espiral de Fermat
    const radio = zonaComúnRadius + config.gap + spacingFactor * Math.sqrt(i + 1);
    const angulo = goldenAngle * (i + 1);

    const posX = Math.round(centro + radio * Math.cos(angulo));
    const posY = Math.round(centro + radio * Math.sin(angulo));

    // Encontrar el índice original para el color
    const idxOriginal = empresas.findIndex((e) => e.id === empresa.id);

    zonas.push({
      empresa_id: empresa.id,
      nombre_zona: empresa.nombre,
      posicion_x: posX,
      posicion_y: posY,
      ancho: tamano.ancho,
      alto: tamano.alto,
      color: asignarColor(idxOriginal >= 0 ? idxOriginal : i, empresa.color_preferido),
      es_comun: false,
      spawn_x: posX,
      spawn_y: posY,
    });
  }

  return zonas;
}

// ===== Selección automática de algoritmo =====

function seleccionarAlgoritmo(n: number, config: Required<LayoutConfig>): LayoutConfig['algoritmo'] {
  if (config.algoritmo !== 'radial') return config.algoritmo;

  // Auto-selección basada en cantidad de empresas
  if (n <= 8) return 'radial';       // Pocas empresas: radial limpio
  if (n <= 20) return 'organico';     // Muchas: espiral orgánica
  return 'grid';                      // Masivo: grid ordenado
}

// ===== API Principal =====

const DEFAULTS: Required<LayoutConfig> = {
  worldSize: 800,
  zonaSizeMin: 120,
  zonaSizeMax: 280,
  zonaComúnSize: 0, // 0 = auto
  gap: 24,
  incluirZonaComun: true,
  algoritmo: 'radial',
};

export function generarLayoutZonas(
  empresas: EmpresaParaLayout[],
  configParcial?: LayoutConfig
): LayoutResult {
  const config: Required<LayoutConfig> = { ...DEFAULTS, ...configParcial };

  const algoritmo = seleccionarAlgoritmo(empresas.length, config);
  let zonas: ZonaGenerada[];

  switch (algoritmo) {
    case 'grid':
      zonas = layoutGrid(empresas, config);
      break;
    case 'organico':
      zonas = layoutOrganico(empresas, config);
      break;
    case 'radial':
    default:
      zonas = layoutRadial(empresas, config);
      break;
  }

  // Clamp: asegurar que ninguna zona se salga del mundo
  zonas = zonas.map((zona) => ({
    ...zona,
    posicion_x: Math.max(zona.ancho / 2, Math.min(config.worldSize - zona.ancho / 2, zona.posicion_x)),
    posicion_y: Math.max(zona.alto / 2, Math.min(config.worldSize - zona.alto / 2, zona.posicion_y)),
  }));

  return {
    zonas,
    worldSizeUsado: config.worldSize,
    algoritmoUsado: algoritmo!,
  };
}

// ===== Detección de overlaps (para validación) =====

export function detectarOverlaps(zonas: ZonaGenerada[]): Array<{ a: string; b: string; overlapArea: number }> {
  const overlaps: Array<{ a: string; b: string; overlapArea: number }> = [];

  for (let i = 0; i < zonas.length; i++) {
    for (let j = i + 1; j < zonas.length; j++) {
      const a = zonas[i];
      const b = zonas[j];

      const aLeft = a.posicion_x - a.ancho / 2;
      const aRight = a.posicion_x + a.ancho / 2;
      const aTop = a.posicion_y - a.alto / 2;
      const aBottom = a.posicion_y + a.alto / 2;

      const bLeft = b.posicion_x - b.ancho / 2;
      const bRight = b.posicion_x + b.ancho / 2;
      const bTop = b.posicion_y - b.alto / 2;
      const bBottom = b.posicion_y + b.alto / 2;

      const overlapX = Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft));
      const overlapY = Math.max(0, Math.min(aBottom, bBottom) - Math.max(aTop, bTop));
      const area = overlapX * overlapY;

      if (area > 0) {
        overlaps.push({
          a: a.nombre_zona,
          b: b.nombre_zona,
          overlapArea: Math.round(area),
        });
      }
    }
  }

  return overlaps;
}
