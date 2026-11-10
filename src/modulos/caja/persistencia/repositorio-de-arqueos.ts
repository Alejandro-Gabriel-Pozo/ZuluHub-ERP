import { sql, type Kysely } from "kysely";
import { importeATexto, importeDesdeTexto, type Importe } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import {
  personaId,
  type EmpresaId,
  type PersonaId,
} from "../../../primitivas/identificadores/marca";
import type { BilleteContado, LineaDeArqueo } from "../dominio/arqueo";
import type { TipoDeMedio } from "../estados";
import type { CajaDb } from "./esquema";

/** Una línea del arqueo guardado, con lo del medio y la cuenta que hace falta para mostrarla. */
export type LineaDeArqueoGuardada = Readonly<{
  medioDePagoId: string;
  medioTipo: TipoDeMedio;
  medioNombre: string | null;
  cuentaDeCobroId: string | null;
  cuentaNombre: string | null;
  esperado: Importe;
  /** Efectivo: billetes + monedas; demás medios: el total declarado; `null` si la línea es conforme. */
  contado: Importe | null;
  contadoMonedas: Importe | null;
  conforme: boolean;
  conformePor: PersonaId | null;
  conformeEn: Date | null;
  /** contado − esperado; `null` si la línea es conforme. La calcula la base. */
  diferencia: Importe | null;
}>;

export type ArqueoGuardado = Readonly<{
  lineas: readonly LineaDeArqueoGuardada[];
  billetes: readonly BilleteContado[];
}>;

/**
 * Persistencia del arqueo de una sesión: una línea por (medio, cuenta) y el detalle de billetes del efectivo. Solo inserción, y solo al
 * cerrar la sesión en la misma transacción (disparadores de la base). La base repite el cálculo al confirmar: una línea por cada
 * (medio, cuenta) con movimientos más la del efectivo, el esperado como Σ real y el efectivo contado como billetes más monedas.
 */
export interface RepositorioDeArqueos {
  /** Guarda las líneas y el detalle de billetes de la sesión que esta transacción acaba de cerrar. */
  guardar(
    empresa: EmpresaId,
    sesionId: string,
    lineas: readonly LineaDeArqueo[],
    billetes: readonly BilleteContado[],
  ): Promise<void>;
  /** El arqueo guardado de la sesión (vacío si no se cerró). Solo lectura. */
  deLaSesion(empresa: EmpresaId, sesionId: string): Promise<ArqueoGuardado>;
  /** El efectivo contado en el último cierre de esa caja (billetes + monedas), o `null` si nunca se cerró. Solo lectura. */
  ultimoEfectivoContadoDeLaCaja(empresa: EmpresaId, cajaId: string): Promise<Importe | null>;
}

const texto = (importe: Importe | null): string | null =>
  importe === null ? null : importeATexto(importe);
const importeONulo = (valor: string | null): Importe | null =>
  valor === null ? null : importeDesdeTexto(ARS, valor);

export function crearRepositorioDeArqueos(db: Kysely<CajaDb>): RepositorioDeArqueos {
  return {
    async guardar(empresa, sesionId, lineas, billetes) {
      // Los billetes primero: al insertar la línea del efectivo la base ya ve el detalle (el chequeo final es al confirmar).
      if (billetes.length > 0) {
        await db
          .insertInto("arqueo_billete")
          .values(
            billetes.map((b) => ({
              empresa_id: empresa,
              sesion_id: sesionId,
              denominacion: b.denominacion,
              cantidad: b.cantidad,
            })),
          )
          .execute();
      }
      await db
        .insertInto("arqueo_caja")
        .values(
          lineas.map((l) => ({
            empresa_id: empresa,
            sesion_id: sesionId,
            medio_de_pago_id: l.medioDePagoId,
            cuenta_de_cobro_id: l.cuentaDeCobroId,
            esperado: importeATexto(l.esperado),
            contado: texto(l.contado),
            contado_monedas: texto(l.contadoMonedas),
            conforme: l.conforme,
            conforme_por: l.conformePor,
            conforme_en: l.conformeEn,
          })),
        )
        .execute();
    },

    async deLaSesion(empresa, sesionId) {
      const filas = await db
        .selectFrom("arqueo_caja as a")
        .innerJoin("medio_de_pago as md", (unir) =>
          unir
            .onRef("md.id", "=", "a.medio_de_pago_id")
            .onRef("md.empresa_id", "=", "a.empresa_id"),
        )
        .leftJoin("cuenta_de_cobro as cu", (unir) =>
          unir
            .onRef("cu.id", "=", "a.cuenta_de_cobro_id")
            .onRef("cu.empresa_id", "=", "a.empresa_id"),
        )
        .select([
          "a.medio_de_pago_id as medio_de_pago_id",
          "md.tipo as medio_tipo",
          "md.nombre as medio_nombre",
          "a.cuenta_de_cobro_id as cuenta_de_cobro_id",
          "cu.nombre as cuenta_nombre",
          sql<string>`a.esperado::text`.as("esperado"),
          sql<string | null>`a.contado::text`.as("contado"),
          sql<string | null>`a.contado_monedas::text`.as("contado_monedas"),
          "a.conforme as conforme",
          "a.conforme_por as conforme_por",
          "a.conforme_en as conforme_en",
          sql<string | null>`a.diferencia::text`.as("diferencia"),
        ])
        .where("a.empresa_id", "=", empresa)
        .where("a.sesion_id", "=", sesionId)
        .orderBy("a.medio_de_pago_id")
        .orderBy("a.cuenta_de_cobro_id")
        .execute();
      const billetes = await db
        .selectFrom("arqueo_billete")
        .select(["denominacion", "cantidad"])
        .where("empresa_id", "=", empresa)
        .where("sesion_id", "=", sesionId)
        .orderBy("denominacion", "desc")
        .execute();
      return {
        lineas: filas.map((fila) => ({
          medioDePagoId: fila.medio_de_pago_id,
          medioTipo: fila.medio_tipo,
          medioNombre: fila.medio_nombre,
          cuentaDeCobroId: fila.cuenta_de_cobro_id,
          cuentaNombre: fila.cuenta_nombre,
          esperado: importeDesdeTexto(ARS, fila.esperado),
          contado: importeONulo(fila.contado),
          contadoMonedas: importeONulo(fila.contado_monedas),
          conforme: fila.conforme,
          conformePor: fila.conforme_por === null ? null : personaId(fila.conforme_por),
          conformeEn: fila.conforme_en,
          diferencia: importeONulo(fila.diferencia),
        })),
        billetes: billetes.map((b) => ({ denominacion: b.denominacion, cantidad: b.cantidad })),
      };
    },

    async ultimoEfectivoContadoDeLaCaja(empresa, cajaId) {
      const fila = await db
        .selectFrom("arqueo_caja as a")
        .innerJoin("sesion_caja as s", (unir) =>
          unir.onRef("s.id", "=", "a.sesion_id").onRef("s.empresa_id", "=", "a.empresa_id"),
        )
        .innerJoin("medio_de_pago as md", (unir) =>
          unir
            .onRef("md.id", "=", "a.medio_de_pago_id")
            .onRef("md.empresa_id", "=", "a.empresa_id"),
        )
        .select(sql<string | null>`a.contado::text`.as("contado"))
        .where("a.empresa_id", "=", empresa)
        .where("s.caja_id", "=", cajaId)
        .where("s.estado", "=", "CERRADA")
        .where("md.tipo", "=", "EFECTIVO")
        .orderBy("s.cerrada_en", "desc")
        .orderBy("s.id", "desc")
        .limit(1)
        .executeTakeFirst();
      return fila === undefined ? null : importeONulo(fila.contado);
    },
  };
}
