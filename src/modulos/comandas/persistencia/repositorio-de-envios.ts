import { sql, type Kysely } from "kysely";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import type { VentasDb } from "../../ventas/publico";
import type { ComandasDb } from "./esquema";
import type {
  Aviso,
  FilaDeComanda,
  RepositorioDeEnvios,
  ResumenDeComandas,
} from "./contrato-de-envios";
import { aEnvio, aRenglon } from "./mapeos-de-envios";

export type {
  AltaDeEnvio,
  Aviso,
  Envio,
  FilaDeComanda,
  RepositorioDeEnvios,
  ResumenDeComandas,
  Renglon,
} from "./contrato-de-envios";

type Db = Kysely<ComandasDb & VentasDb>;

export function crearRepositorioDeEnvios(db: Db): RepositorioDeEnvios {
  const seleccionarEnvio = () =>
    db
      .selectFrom("envio_de_comanda")
      .select([
        "id",
        "sucursal_id",
        "cuenta_id",
        "numero",
        "tipo",
        "rotulo",
        "enviado_por",
        "enviado_en",
        sql<string>`fecha_negocio::text`.as("fecha_negocio"),
        "clave",
        "huella",
      ]);

  const seleccionarFila = () =>
    db
      .selectFrom("linea_de_comanda as d")
      .leftJoin("envio_de_comanda as e", (j) =>
        j.onRef("e.id", "=", "d.envio_id").onRef("e.empresa_id", "=", "d.empresa_id"),
      )
      .select(["d.linea_id", "d.salida", "d.envio_id", "e.numero as numero_de_envio"]);
  type FilaSel = Awaited<ReturnType<ReturnType<typeof seleccionarFila>["execute"]>>[number];
  const aFila = (f: FilaSel): FilaDeComanda => ({
    lineaId: f.linea_id,
    salida: f.salida,
    envioId: f.envio_id,
    numeroDeEnvio: f.numero_de_envio,
  });

  const aAviso = (f: {
    id: string;
    cuenta_id: string;
    linea_origen_id: string;
    envio_id: string;
    cantidad: string;
    quedan: string;
    motivo: string;
    nombre_de_cocina: string;
    detalle_de_cocina: string[];
    rotulo: string;
    anulado_por: string;
    anulado_en: Date;
  }): Aviso => ({
    id: f.id,
    cuentaId: f.cuenta_id,
    lineaOrigenId: f.linea_origen_id,
    envioId: f.envio_id,
    cantidad: f.cantidad,
    quedan: f.quedan,
    motivo: f.motivo,
    nombreDeCocina: f.nombre_de_cocina,
    detalleDeCocina: f.detalle_de_cocina,
    rotulo: f.rotulo,
    anuladoPor: f.anulado_por as PersonaId,
    anuladoEn: f.anulado_en,
  });
  const columnasDeAviso = [
    "id",
    "cuenta_id",
    "linea_origen_id",
    "envio_id",
    "cantidad",
    "quedan",
    "motivo",
    "nombre_de_cocina",
    "detalle_de_cocina",
    "rotulo",
    "anulado_por",
    "anulado_en",
  ] as const;

  return {
    async siguienteNumero(empresa, cuentaId) {
      await db
        .insertInto("contador_de_envios")
        .values({ empresa_id: empresa, cuenta_id: cuentaId })
        .onConflict((oc) => oc.doNothing())
        .execute();
      const fila = await db
        .updateTable("contador_de_envios")
        .set({ ultimo: sql<number>`ultimo + 1` })
        .where("empresa_id", "=", empresa)
        .where("cuenta_id", "=", cuentaId)
        .returning("ultimo")
        .executeTakeFirstOrThrow();
      return fila.ultimo;
    },

    async insertarEnvio(empresa, alta) {
      await db
        .insertInto("envio_de_comanda")
        .values({
          id: alta.id,
          empresa_id: empresa,
          sucursal_id: alta.sucursalId,
          cuenta_id: alta.cuentaId,
          numero: alta.numero,
          tipo: alta.tipo,
          rotulo: alta.rotulo,
          enviado_por: alta.enviadoPor,
          enviado_en: alta.enviadoEn,
          clave: alta.clave,
          huella: alta.huella,
        })
        .execute();
      const fila = await seleccionarEnvio()
        .where("empresa_id", "=", empresa)
        .where("id", "=", alta.id)
        .executeTakeFirstOrThrow();
      return aEnvio(fila);
    },

    async envioPorId(empresa, id) {
      const fila = await seleccionarEnvio()
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aEnvio(fila);
    },

    async envioPorClave(empresa, clave) {
      const fila = await seleccionarEnvio()
        .where("empresa_id", "=", empresa)
        .where("clave", "=", clave)
        .executeTakeFirst();
      return fila === undefined ? null : aEnvio(fila);
    },

    async enviosDeCuenta(empresa, cuentaId) {
      const filas = await seleccionarEnvio()
        .where("empresa_id", "=", empresa)
        .where("cuenta_id", "=", cuentaId)
        .orderBy("numero")
        .execute();
      return filas.map(aEnvio);
    },

    async insertarRenglones(empresa, envioId, renglones) {
      if (renglones.length === 0) return;
      await db
        .insertInto("renglon_de_envio")
        .values(
          renglones.map((r) => ({
            empresa_id: empresa,
            envio_id: envioId,
            orden: r.orden,
            linea_id: r.lineaId,
            cantidad: r.cantidad,
            rol: r.rol,
            nombre_de_cocina: r.nombreDeCocina,
            detalle_de_cocina: [...r.detalleDeCocina],
          })),
        )
        .execute();
    },

    async renglonesDeEnvio(empresa, envioId) {
      const filas = await db
        .selectFrom("renglon_de_envio")
        .select(["orden", "linea_id", "cantidad", "rol", "nombre_de_cocina", "detalle_de_cocina"])
        .where("empresa_id", "=", empresa)
        .where("envio_id", "=", envioId)
        .orderBy("orden")
        .execute();
      return filas.map(aRenglon);
    },

    async renglonDeSalida(empresa, lineaId) {
      const fila = await db
        .selectFrom("renglon_de_envio as r")
        .innerJoin("envio_de_comanda as e", (j) =>
          j.onRef("e.id", "=", "r.envio_id").onRef("e.empresa_id", "=", "r.empresa_id"),
        )
        .select([
          "r.orden",
          "r.linea_id",
          "r.cantidad",
          "r.rol",
          "r.nombre_de_cocina",
          "r.detalle_de_cocina",
          "e.id as e_id",
          "e.sucursal_id",
          "e.cuenta_id",
          "e.numero",
          "e.tipo",
          "e.rotulo",
          "e.enviado_por",
          "e.enviado_en",
          sql<string>`e.fecha_negocio::text`.as("fecha_negocio"),
          "e.clave",
          "e.huella",
        ])
        .where("r.empresa_id", "=", empresa)
        .where("r.linea_id", "=", lineaId)
        .where("r.rol", "=", "SALE")
        .orderBy("e.numero")
        .executeTakeFirst();
      if (fila === undefined) return null;
      return {
        renglon: aRenglon(fila),
        envio: aEnvio({
          id: fila.e_id,
          sucursal_id: fila.sucursal_id,
          cuenta_id: fila.cuenta_id,
          numero: fila.numero,
          tipo: fila.tipo,
          rotulo: fila.rotulo,
          enviado_por: fila.enviado_por,
          enviado_en: fila.enviado_en,
          fecha_negocio: fila.fecha_negocio,
          clave: fila.clave,
          huella: fila.huella,
        }),
      };
    },

    async asegurarFilas(empresa, cuentaId, lineaIds) {
      if (lineaIds.length === 0) return;
      await db
        .insertInto("linea_de_comanda")
        .values(
          lineaIds.map((l) => ({
            empresa_id: empresa,
            linea_id: l,
            cuenta_id: cuentaId,
            envio_id: null,
          })),
        )
        .onConflict((oc) => oc.doNothing())
        .execute();
    },

    async filaDeComanda(empresa, lineaId) {
      const fila = await seleccionarFila()
        .where("d.empresa_id", "=", empresa)
        .where("d.linea_id", "=", lineaId)
        .executeTakeFirst();
      return fila === undefined ? null : aFila(fila);
    },

    async filasDeCuenta(empresa, cuentaId) {
      const filas = await seleccionarFila()
        .where("d.empresa_id", "=", empresa)
        .where("d.cuenta_id", "=", cuentaId)
        .orderBy("d.linea_id")
        .execute();
      return filas.map(aFila);
    },

    async tomarParaEnviar(empresa, envioId, lineaIds) {
      if (lineaIds.length === 0) return [];
      const filas = await db
        .updateTable("linea_de_comanda")
        .set({ envio_id: envioId })
        .where("empresa_id", "=", empresa)
        .where("linea_id", "in", [...lineaIds])
        .where("envio_id", "is", null)
        .returning("linea_id")
        .execute();
      return filas.map((f) => f.linea_id);
    },

    async cambiarSalida(empresa, lineaId, salida) {
      const r = await db
        .updateTable("linea_de_comanda")
        .set({ salida })
        .where("empresa_id", "=", empresa)
        .where("linea_id", "=", lineaId)
        .where("envio_id", "is", null)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async insertarFila(empresa, fila) {
      await db
        .insertInto("linea_de_comanda")
        .values({
          empresa_id: empresa,
          linea_id: fila.lineaId,
          cuenta_id: fila.cuentaId,
          salida: fila.salida,
          envio_id: fila.envioId,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    },

    async resumenPorCuentas(empresa, cuentaIds) {
      const resumen = new Map<string, ResumenDeComandas>();
      if (cuentaIds.length === 0) return resumen;
      // Una línea vigente sin fila cuenta como para enviar (fail closed): se parte de `linea_cuenta` y se une la comanda.
      const filas = await sql<{
        cuenta_id: string;
        para_enviar: string;
        en_espera: string;
        envios: string;
      }>`
        select c.id as cuenta_id,
               (select count(*) from linea_cuenta l left join linea_de_comanda d on d.empresa_id = l.empresa_id and d.linea_id = l.id
                 where l.empresa_id = c.empresa_id and l.cuenta_id = c.id and l.estado = 'VIGENTE'
                   and d.envio_id is null and coalesce(d.salida, 'AHORA') = 'AHORA') as para_enviar,
               (select count(*) from linea_cuenta l join linea_de_comanda d on d.empresa_id = l.empresa_id and d.linea_id = l.id
                 where l.empresa_id = c.empresa_id and l.cuenta_id = c.id and l.estado = 'VIGENTE'
                   and d.envio_id is null and d.salida = 'DESPUES') as en_espera,
               -- Los envíos de la cuenta, o los de los que vienen sus ítems ya enviados (una cuenta hija de una división o el destino de una unión no tuvo
               -- envíos propios, pero lo que heredó ya salió a cocina).
               greatest(
                 (select count(*) from envio_de_comanda e where e.empresa_id = c.empresa_id and e.cuenta_id = c.id),
                 (select count(distinct d.envio_id) from linea_cuenta l join linea_de_comanda d on d.empresa_id = l.empresa_id and d.linea_id = l.id
                   where l.empresa_id = c.empresa_id and l.cuenta_id = c.id and l.estado = 'VIGENTE' and d.envio_id is not null)) as envios
          from cuenta_consumo c
         where c.empresa_id = ${empresa} and c.id in (${sql.join(cuentaIds.map((id) => sql`${id}::uuid`))})`.execute(
        db,
      );
      for (const f of filas.rows) {
        resumen.set(f.cuenta_id, {
          paraEnviar: Number(f.para_enviar),
          enEspera: Number(f.en_espera),
          envios: Number(f.envios),
        });
      }
      return resumen;
    },

    async insertarAviso(empresa, aviso) {
      const fila = await db
        .insertInto("aviso_de_anulacion")
        .values({
          id: aviso.id,
          empresa_id: empresa,
          cuenta_id: aviso.cuentaId,
          linea_origen_id: aviso.lineaOrigenId,
          envio_id: aviso.envioId,
          cantidad: aviso.cantidad,
          quedan: aviso.quedan,
          motivo: aviso.motivo,
          nombre_de_cocina: aviso.nombreDeCocina,
          detalle_de_cocina: [...aviso.detalleDeCocina],
          rotulo: aviso.rotulo,
          anulado_por: aviso.anuladoPor,
          anulado_en: aviso.anuladoEn,
        })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      return fila !== undefined;
    },

    async avisoPorId(empresa, id) {
      const fila = await db
        .selectFrom("aviso_de_anulacion")
        .select(columnasDeAviso)
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aAviso(fila);
    },

    async avisoPorLinea(empresa, lineaOrigenId) {
      const fila = await db
        .selectFrom("aviso_de_anulacion")
        .select(columnasDeAviso)
        .where("empresa_id", "=", empresa)
        .where("linea_origen_id", "=", lineaOrigenId)
        .executeTakeFirst();
      return fila === undefined ? null : aAviso(fila);
    },
  };
}
