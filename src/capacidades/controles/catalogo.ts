/**
 * Catálogo de controles (ADR-008). Es código, no base de datos: de acá sale el tipo cerrado
 * `ClaveDeControl`, así que un control mal escrito o sin catalogar no compila. Como las perillas, un
 * control que nadie verifica no se declara: cada módulo registra el suyo en el tramo que lo evalúa
 * (caja: `caja.cierre_con_diferencia`, `caja.devolucion_supera_cobro`, `caja.cobro_en_jornada_vencida`;
 * stock: `stock.existencia_negativa`; reservas y facturación, los suyos). Hoy está vacío a propósito.
 *
 * La clave es `modulo.nombre_del_control`, con la forma que exige el CHECK `nivel_de_control_control_ck`
 * de la base: una clave que no la cumpla no podría guardar nunca su nivel (la prueba de este archivo la
 * exige a cada entrada).
 */
export type DefinicionDeControl = Readonly<{
  /** Qué vigila, en una línea (para quien lo configura y para la auditoría). */
  descripcion: string;
}>;

export type CatalogoDeControles = Readonly<Record<string, DefinicionDeControl>>;

/** Misma forma que el CHECK `nivel_de_control_control_ck` (0007): minúsculas, un punto y guion bajo. */
export const FORMA_DE_CLAVE_DE_CONTROL = /^[a-z]+\.[a-z_]+$/;

export const CATALOGO_DE_CONTROLES = {} as const satisfies CatalogoDeControles;

export type ClaveDeControl = keyof typeof CATALOGO_DE_CONTROLES;
