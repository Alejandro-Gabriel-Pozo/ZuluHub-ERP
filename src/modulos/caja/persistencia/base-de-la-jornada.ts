import { sql, type Kysely } from "kysely";
import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { TipoDeMedio } from "../estados";
import type { CajaDb } from "./esquema";

/** Un medio y una cuenta (opcional) con los nombres que hacen falta para mostrarlos. */
export type MedioYCuentaConNombre = Readonly<{
  medioDePagoId: string;
  medioTipo: TipoDeMedio;
  medioNombre: string | null;
  cuentaDeCobroId: string | null;
  cuentaNombre: string | null;
}>;

/**
 * Los movimientos de las sesiones de la jornada `(sucursal, fecha de negocio)`: el movimiento `m`, su sesión `s`, la caja `c` (de donde
 * sale la sucursal), su medio `md` y su cuenta `cu`. La fecha es la de la SESIÓN (el sello), no la de hoy. Es la base de las lecturas del
 * cierre del día: cada una le suma lo suyo.
 */
export function movimientosDeLaJornada(
  db: Kysely<CajaDb>,
  empresa: EmpresaId,
  sucursal: SucursalId,
  fecha: FechaCivil,
) {
  return db
    .selectFrom("movimiento_caja as m")
    .innerJoin("sesion_caja as s", (unir) =>
      unir.onRef("s.id", "=", "m.sesion_id").onRef("s.empresa_id", "=", "m.empresa_id"),
    )
    .innerJoin("caja as c", (unir) =>
      unir.onRef("c.id", "=", "s.caja_id").onRef("c.empresa_id", "=", "s.empresa_id"),
    )
    .innerJoin("medio_de_pago as md", (unir) =>
      unir.onRef("md.id", "=", "m.medio_de_pago_id").onRef("md.empresa_id", "=", "m.empresa_id"),
    )
    .leftJoin("cuenta_de_cobro as cu", (unir) =>
      unir.onRef("cu.id", "=", "m.cuenta_de_cobro_id").onRef("cu.empresa_id", "=", "m.empresa_id"),
    )
    .where("m.empresa_id", "=", empresa)
    .where("c.sucursal_id", "=", sucursal)
    .where(sql<boolean>`s.fecha_negocio = ${fecha}::date`);
}

/** Una fila con las columnas del medio y la cuenta (`select ... as medio_de_pago_id, medio_tipo...`) como un `MedioYCuentaConNombre`. */
export const comoMedio = (
  f: Readonly<{
    medio_de_pago_id: string;
    medio_tipo: TipoDeMedio;
    medio_nombre: string | null;
    cuenta_de_cobro_id: string | null;
    cuenta_nombre: string | null;
  }>,
): MedioYCuentaConNombre => ({
  medioDePagoId: f.medio_de_pago_id,
  medioTipo: f.medio_tipo,
  medioNombre: f.medio_nombre,
  cuentaDeCobroId: f.cuenta_de_cobro_id,
  cuentaNombre: f.cuenta_nombre,
});
