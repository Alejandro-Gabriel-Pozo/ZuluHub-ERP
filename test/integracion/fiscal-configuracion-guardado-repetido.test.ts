import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { domicilioId } from "../../src/modulos/fiscal/publico";
import { emisorId } from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { crearBarrera, crearBaseAparte } from "./entorno";
import {
  casosDeConfiguracion,
  crearEntornoDeConfiguracion,
  crearEscenarioDeConfiguracion,
  domicilioNuevo,
  nuevoUuid,
  otraPersona,
  type EscenarioDeConfiguracion,
} from "./fiscal-configuracion-apoyo";

/**
 * H7 T5: repetir el guardado de un borrador que YA quedó confirmado (se cortó la red al volver la respuesta de
 * confirmar y la pantalla reintenta el guardado). Con los mismos datos es «ya estaba», con la versión confirmada, sin
 * escribir ni auditar; con datos distintos sigue siendo `VERSION_CONFIRMADA_INMUTABLE`. Contra una base real, con el
 * rol limitado de la aplicación.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const AHORA = new Date("2026-10-11T12:00:00Z");
type Fila = Record<string, unknown>;
type Cualquiera = Resultado<unknown, unknown>;

const codigoDe = (r: Cualquiera): string => {
  if (r.ok) return "ok";
  if (typeof r.error === "string") return r.error;
  const tipo = (r.error as { tipo?: unknown }).tipo;
  return typeof tipo === "string" ? tipo : "otro";
};

describe.skipIf(base === null)(
  "fiscal T5: repetir el guardado de un borrador ya confirmado",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: ReturnType<typeof crearEntornoDeConfiguracion>;
    let casos: ReturnType<typeof casosDeConfiguracion>;
    /** Mientras haya una barrera, toda transacción espera en ella tras leer la versión por id. */
    let barrera: { esperar: () => Promise<void> } | null = null;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDeConfiguracion(propia.base, 16, (tx) => ({
        ...tx,
        datosFiscales: {
          ...tx.datosFiscales,
          obtener: async (...args) => {
            const r = await tx.datosFiscales.obtener(...args);
            if (barrera !== null) await barrera.esperar();
            return r;
          },
        },
      }));
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      casos = casosDeConfiguracion(entorno);
    }, 120_000);
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    });

    const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
      (await dueno.query<T>(texto, parametros)).rows;

    /** Todo lo que el guardado podría escribir de una empresa, en una foto para comparar antes y después. */
    async function foto(empresa: string) {
      return {
        datos: await filas(
          `select id, estado, version, numero, razon_social, condicion_iva, domicilio_fiscal_id,
                to_char(inicio_actividades, 'YYYY-MM-DD') as inicio_actividades, vigente_desde, confirmada_en
           from datos_fiscales where empresa_id = $1 order by id`,
          [empresa],
        ),
        domicilios: await filas(
          "select id, calle, numero from domicilio where empresa_id = $1 order by id",
          [empresa],
        ),
        auditoria: await filas(
          "select id, accion from auditoria_empresa where empresa_id = $1 order by id",
          [empresa],
        ),
      };
    }

    const COMPLETOS = {
      razonSocial: "Coop Pampa SA",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      inicioActividades: "2020-03-01",
      iibbNumero: "901-123456-7",
    } as const;

    type PedidoDeGuardar = Parameters<typeof casos.guardarBorradorDeDatosFiscales>[1];
    const guardar = (e: EscenarioDeConfiguracion, pedido: Omit<PedidoDeGuardar, "emisorId">) =>
      casos.guardarBorradorDeDatosFiscales(e.como(AHORA), {
        emisorId: emisorId(e.mundo.emisor),
        ...pedido,
      });
    const confirmar = (e: EscenarioDeConfiguracion, borradorId: string, versionEsperada: number) =>
      casos.confirmarDatosFiscales(e.como(AHORA), {
        emisorId: emisorId(e.mundo.emisor),
        borradorId,
        versionEsperada,
        vigenteDesde: AHORA,
        motivo: "Alta de la empresa",
      });

    /**
     * Lo que hace «Confirmar» en la pantalla: guarda (con el pedido `pedido`) y confirma. Devuelve lo que se mandó,
     * para repetirlo igual, y la versión que quedó confirmada.
     */
    async function guardadoYConfirmado(
      e: EscenarioDeConfiguracion,
      pedido: Omit<PedidoDeGuardar, "emisorId" | "borradorId"> = {
        cambios: COMPLETOS,
        domicilio: domicilioNuevo(),
      },
    ) {
      const mandado = { ...pedido, borradorId: nuevoUuid() };
      const guardado = await guardar(e, mandado);
      if (!guardado.ok) throw new Error(`no se guardó: ${JSON.stringify(guardado.error)}`);
      const confirmado = await confirmar(e, mandado.borradorId, guardado.valor.version);
      if (!confirmado.ok) throw new Error(`no se confirmó: ${JSON.stringify(confirmado.error)}`);
      // Confirmar sube la versión de la fila (la confirmada queda una por encima del borrador que se vio).
      const [fila] = await filas<{ version: number }>(
        "select version from datos_fiscales where id = $1",
        [mandado.borradorId],
      );
      const version = fila?.version ?? -1;
      expect(version).toBe(guardado.valor.version + 1);
      return { mandado, version, numero: confirmado.valor.numero };
    }

    const nuevo = (rol: "GERENTE" | "ADMINISTRADOR" | "OPERADOR" = "GERENTE") =>
      crearEscenarioDeConfiguracion(dueno, { rol });

    // ===============================================================================================
    describe("los mismos datos: «ya estaba»", () => {
      it("el reintento del guardado que creó el borrador (sin versión) tras confirmar es «ya estaba», sin escribir ni auditar; confirmar repetido también", async () => {
        const e = await nuevo();
        const { mandado, version, numero } = await guardadoYConfirmado(e);
        const antes = await foto(e.mundo.empresa);

        const reintento = await guardar(e, mandado);
        expect(reintento).toEqual(ok({ borradorId: mandado.borradorId, version, yaEstaba: true }));
        expect(await foto(e.mundo.empresa)).toEqual(antes);

        // La pantalla sigue con confirmar: tampoco escribe.
        const otraVez = await confirmar(e, mandado.borradorId, version);
        expect(otraVez.ok && otraVez.valor).toMatchObject({
          borradorId: mandado.borradorId,
          numero,
          yaEstaba: true,
        });
        expect(await foto(e.mundo.empresa)).toEqual(antes);
      });

      it("el reintento de una edición (con la versión que vio la pantalla antes o después de guardar) es «ya estaba» con la versión confirmada", async () => {
        const e = await nuevo();
        const borradorId = nuevoUuid();
        const alta = await guardar(e, {
          borradorId,
          cambios: COMPLETOS,
          domicilio: domicilioNuevo(),
        });
        if (!alta.ok) throw new Error("no se guardó");
        const edicion = { borradorId, cambios: { razonSocial: "Coop Pampa SRL" } };
        const editado = await guardar(e, { ...edicion, versionEsperada: alta.valor.version });
        if (!editado.ok) throw new Error("no se editó");
        const confirmado = await confirmar(e, borradorId, editado.valor.version);
        expect(confirmado.ok).toBe(true);
        const [fila] = await filas<{ version: number }>(
          "select version from datos_fiscales where id = $1",
          [borradorId],
        );
        const versionConfirmada = fila?.version ?? -1;
        const antes = await foto(e.mundo.empresa);

        for (const versionEsperada of [alta.valor.version, editado.valor.version, 99, undefined]) {
          expect(
            await guardar(e, { ...edicion, versionEsperada }),
            `versión esperada ${versionEsperada}`,
          ).toEqual(ok({ borradorId, version: versionConfirmada, yaEstaba: true }));
        }
        expect(await foto(e.mundo.empresa)).toEqual(antes);
      });

      it("sin domicilio, con el domicilio existente y con cambios vacíos o repetidos: también es «ya estaba»", async () => {
        const e = await nuevo();
        const { mandado, version } = await guardadoYConfirmado(e);
        const [confirmada] = await filas<{ domicilio_fiscal_id: string }>(
          "select domicilio_fiscal_id from datos_fiscales where id = $1",
          [mandado.borradorId],
        );
        const antes = await foto(e.mundo.empresa);
        const yaEstaba = ok({ borradorId: mandado.borradorId, version, yaEstaba: true });
        const { borradorId } = mandado;

        expect(await guardar(e, { borradorId, cambios: {} })).toEqual(yaEstaba);
        expect(
          await guardar(e, { borradorId, cambios: { razonSocial: "  Coop Pampa SA " } }),
        ).toEqual(yaEstaba);
        expect(
          await guardar(e, {
            borradorId,
            cambios: COMPLETOS,
            domicilio: {
              tipo: "EXISTENTE",
              id: domicilioId(confirmada?.domicilio_fiscal_id ?? ""),
            },
          }),
        ).toEqual(yaEstaba);
        expect(await foto(e.mundo.empresa)).toEqual(antes);
      });
    });

    // ===============================================================================================
    describe("datos distintos: el error de siempre", () => {
      it("otra razón social, otro domicilio (nuevo o existente), o datos que no valen son VERSION_CONFIRMADA_INMUTABLE y no escriben nada", async () => {
        const e = await nuevo();
        const { mandado, version } = await guardadoYConfirmado(e);
        const [otro] = await filas<{ id: string }>(
          "select id from domicilio where empresa_id = $1",
          [e.mundo.empresa],
        );
        const antes = await foto(e.mundo.empresa);
        const { borradorId } = mandado;
        const inmutable = err("VERSION_CONFIRMADA_INMUTABLE");

        expect(
          await guardar(e, {
            borradorId,
            versionEsperada: version,
            cambios: { razonSocial: "Otra SA" },
          }),
        ).toEqual(inmutable);
        expect(
          await guardar(e, { borradorId, cambios: { inicioActividades: "2021-01-01" } }),
        ).toEqual(inmutable);
        expect(await guardar(e, { borradorId, cambios: { condicionIva: "MONOTRIBUTO" } })).toEqual(
          inmutable,
        );
        expect(await guardar(e, { borradorId, cambios: { iibbNumero: "123" } })).toEqual(inmutable);
        // Un campo que no vale no es la repetición de nada.
        expect(await guardar(e, { borradorId, cambios: { razonSocial: "  " } })).toEqual(inmutable);
        // Otro domicilio nuevo: no se inserta para comprobarlo.
        expect(
          await guardar(e, {
            borradorId,
            cambios: COMPLETOS,
            domicilio: domicilioNuevo({ calle: "Mitre" }),
          }),
        ).toEqual(inmutable);
        // El mismo `id` de domicilio con otro contenido: la base no lo deja cambiar.
        expect(
          await guardar(e, {
            borradorId,
            cambios: COMPLETOS,
            domicilio: domicilioNuevo({ calle: "Mitre" }, otro?.id),
          }),
        ).toEqual(inmutable);
        expect(await foto(e.mundo.empresa)).toEqual(antes);
      });

      it("un domicilio existente que no es el confirmado, o uno inexistente, es VERSION_CONFIRMADA_INMUTABLE", async () => {
        const e = await nuevo();
        const { mandado } = await guardadoYConfirmado(e);
        // Otro domicilio de la misma empresa, que no es el confirmado (lo deja una segunda versión).
        const segunda = await guardadoYConfirmado(e, {
          cambios: COMPLETOS,
          domicilio: domicilioNuevo({ calle: "Belgrano" }),
        });
        const segundo = segunda.mandado.domicilio?.id ?? "";
        const antes = await foto(e.mundo.empresa);
        for (const id of [segundo, nuevoUuid()]) {
          expect(
            await guardar(e, {
              borradorId: mandado.borradorId,
              cambios: COMPLETOS,
              domicilio: { tipo: "EXISTENTE", id: domicilioId(id) },
            }),
          ).toEqual(err("VERSION_CONFIRMADA_INMUTABLE"));
        }
        expect(await foto(e.mundo.empresa)).toEqual(antes);
      });
    });

    // ===============================================================================================
    describe("dos reintentos a la vez", () => {
      it("todos ven la versión confirmada: «ya estaba» para cada uno, una sola fila, sin escribir ni auditar", async () => {
        for (let ronda = 0; ronda < 3; ronda++) {
          const e = await nuevo();
          const { mandado, version } = await guardadoYConfirmado(e);
          const antes = await foto(e.mundo.empresa);
          barrera = { esperar: crearBarrera(3) };
          let resultados: Cualquiera[];
          try {
            resultados = await Promise.all([
              guardar(e, mandado),
              guardar(e, mandado),
              // El segundo paso de la pantalla, a la vez que sus dos reintentos.
              confirmar(e, mandado.borradorId, version),
            ]);
          } finally {
            barrera = null;
          }
          for (const r of resultados) {
            expect(codigoDe(r), `ronda ${ronda}`).toBe("ok");
            expect(r.ok && r.valor).toMatchObject({
              borradorId: mandado.borradorId,
              yaEstaba: true,
            });
          }
          expect(await foto(e.mundo.empresa), `ronda ${ronda}`).toEqual(antes);
        }
      });
    });

    // ===============================================================================================
    describe("empresa y permiso", () => {
      it("otra empresa no ve la versión confirmada: con el emisor ajeno es EMISOR_NO_ENCONTRADO; con el propio, un borrador nuevo no pisa nada", async () => {
        const a = await nuevo();
        const b = await nuevo();
        const { mandado } = await guardadoYConfirmado(a);
        const antesA = await foto(a.mundo.empresa);
        const antesB = await foto(b.mundo.empresa);

        // El contexto de B con el emisor de A.
        expect(
          await casos.guardarBorradorDeDatosFiscales(b.como(AHORA), {
            emisorId: emisorId(a.mundo.emisor),
            ...mandado,
          }),
        ).toEqual(err("EMISOR_NO_ENCONTRADO"));
        // El contexto de B con su emisor y el `borradorId` de A: no es «ya estaba».
        const r = await guardar(b, mandado);
        expect(r.ok).toBe(false);
        expect(await foto(a.mundo.empresa)).toEqual(antesA);
        expect(await foto(b.mundo.empresa)).toEqual(antesB);
      });

      it.each(["ADMINISTRADOR", "OPERADOR"] as const)(
        "un %s de la empresa que reintenta recibe SIN_PERMISO y no cambia nada",
        async (rol) => {
          const e = await nuevo();
          const { mandado } = await guardadoYConfirmado(e);
          const antes = await foto(e.mundo.empresa);
          const otro = await otraPersona(dueno, e, rol);
          expect(await guardar(otro, mandado)).toEqual(err("SIN_PERMISO"));
          expect(await foto(e.mundo.empresa)).toEqual(antes);
        },
      );
    });
  },
);
