import {
  Building2,
  CircleCheck,
  Clock,
  FileText,
  House,
  Info,
  LogOut,
  Menu,
  OctagonAlert,
  Search,
  Share2,
  TriangleAlert,
  UserRound,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";

/**
 * Catálogo cerrado de íconos de la interfaz ([02] §4.2). La clave nombra el SIGNIFICADO en Pedernal,
 * no el dibujo ni la librería: cambiar de juego de íconos toca solo este archivo. Es la ÚNICA puerta a
 * `lucide-react` (R-W6); una clave que no está acá no compila. La marca no elige íconos en v1.
 * Solo hay las claves que algún componente usa: cada pantalla suma las suyas (`cobrar`, `ticket`, `caja`…)
 * cuando exista, y una clave que nadie usa se quita (lo verifica `Icono.test.tsx`).
 */
export const CATALOGO_DE_ICONOS = {
  // Estado: siempre van con su texto (el color solo no comunica).
  "estado-peligro": OctagonAlert,
  "estado-exito": CircleCheck,
  "estado-aviso": TriangleAlert,
  "estado-info": Info,
  // Patrones de la interfaz.
  "sin-conexion": WifiOff,
  cerrar: X,
  reloj: Clock,
  // Navegación del mostrador y sesión (W5).
  inicio: House,
  empresa: Building2,
  cuenta: UserRound,
  salir: LogOut,
  // Facturador: el módulo de comprobantes. Ícono «Comprobantes» (hoja con renglones): Aprobado por el dueño el 2026-10-29 (respuesta en la sesión web del carril web).
  comprobantes: FileText,
  // Carta pública (C-2).
  secciones: Menu,
  compartir: Share2,
  buscar: Search,
} as const satisfies Record<string, LucideIcon>;

export type ClaveDeIcono = keyof typeof CATALOGO_DE_ICONOS;

/** Escala cerrada ([02] §4.3): nada de tamaños sueltos. */
export const TAMANOS_DE_ICONO = { chico: 16, medio: 20, grande: 24 } as const;
export type TamanoDeIcono = keyof typeof TAMANOS_DE_ICONO;
