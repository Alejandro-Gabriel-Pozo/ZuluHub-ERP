import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearEmisionArca } from "../../src/adaptadores/arca/adaptador-arca";
import type { Transporte } from "../../src/adaptadores/arca/tipos";
import { crearVerificacionDeAutorizacion } from "../../src/adaptadores/certificados/verificacion-de-autorizacion";
import { certificadoId } from "../../src/modulos/fiscal/publico";
import { cuitDesdeTexto } from "../../src/primitivas/identificacion-fiscal/cuit";
import { emisorId, empresaId } from "../../src/primitivas/identificadores/marca";
import { Secreto } from "../../src/primitivas/secreto/secreto";
import { campoConPosibleSecreto, type Dato } from "../../src/puertos/sin-secretos";
import { grabacion, respuestaHttp, TransporteFalso } from "../utilidades/arca";
import {
  RelojDeCertificados,
  almacenDe,
  casosDeCertificados,
  certificadoDeArca,
  credencialesDe,
  crearEntornoDeCertificados,
  crearServicios,
  cuitConPrefijo,
  escenarioDeSociedad,
  pedidoDeCertificado,
  type ServiciosDePrueba,
} from "./certificados-apoyo";
import { crearBarrera, crearBaseAparte } from "./entorno";

/**
 * D-42 (2026-10-29): un certificado nace «autorización sin verificar» y la PRIMERA llamada exitosa a ARCA con su ticket lo
 * anota (`autorizacion_verificada_en`), una sola vez. Contra una base real, con el rol limitado de la aplicación:
 * la anotación (idempotente, de a una bajo concurrencia, aislada por empresa y solo del vigente) y el adaptador real de
 * ARCA contra el transporte falso que sirve las respuestas grabadas, con las credenciales y el almacén de tickets
 * reales. Lo que se vigila en todo resultado: ni la clave ni el ticket aparecen en la auditoría.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

type Fila = Record<string, unknown>;

describe.skipIf(base === null)(
  "certificados D-42: la autorización se verifica con la primera llamada exitosa",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: ReturnType<typeof crearEntornoDeCertificados>;
    let servicios: ServiciosDePrueba;
    let casos: ReturnType<typeof casosDeCertificados>;
    /** Mientras haya una barrera, toda anotación espera en ella justo antes de escribir. */
    let barrera: (() => Promise<void>) | null = null;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDeCertificados(propia.base, 16, (tx) => ({
        ...tx,
        certificados: {
          ...tx.certificados,
          anotarVerificacion: async (...args) => {
            if (barrera !== null) await barrera();
            return tx.certificados.anotarVerificacion(...args);
          },
        },
      }));
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      servicios = await crearServicios();
      casos = casosDeCertificados(entorno, servicios);
    }, 120_000);
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    });

    const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
      (await dueno.query<T>(texto, parametros)).rows;
    const verificada = async (id: string) =>
      (
        await filas<{ en: Date | null; version: number; estado: string }>(
          "select autorizacion_verificada_en as en, version, estado from certificado_arca where id = $1",
          [id],
        )
      )[0];
    const auditorias = async (empresa: string, id: string) =>
      await filas<{ accion: string; actor: string | null; antes: Dato; despues: Dato }>(
        `select accion, actor_persona_id as actor, antes, despues from auditoria_empresa
        where empresa_id = $1 and entidad_id = $2 and accion = 'CERTIFICADO_AUTORIZACION_VERIFICADA' order by id`,
        [empresa, id],
      );
    const verificacionCon = (reloj: { ahora(): Date }) =>
      crearVerificacionDeAutorizacion({ transacciones: entorno, reloj });

    /** Una sociedad con un certificado de una persona física ya VIGENTE y sin verificar. */
    async function conCertificadoVigente() {
      const e = await escenarioDeSociedad(dueno, propia.base);
      const entrada = pedidoDeCertificado(e, { cuitTitular: cuitConPrefijo("20") });
      const pedido = await casos.generarPedidoDeCertificado(e.como(new Date()), entrada);
      if (!pedido.ok) throw new Error(`pedido: ${JSON.stringify(pedido.error)}`);
      const pem = await certificadoDeArca(servicios, "HOMOLOGACION", pedido.valor.pedidoPem);
      const carga = await casos.cargarCertificado(e.como(new Date()), {
        certificadoId: certificadoId(entrada.id),
        certificadoPem: pem,
      });
      if (!carga.ok) throw new Error(`carga: ${JSON.stringify(carga.error)}`);
      return { e, id: entrada.id, pedido: pedido.valor, pem };
    }

    // ===============================================================================================
    describe("anotar la verificación", () => {
      it("el certificado recién cargado está sin verificar; anotar fija la hora, audita el hecho (sin el contenido) y no toca nada más", async () => {
        const { e, id } = await conCertificadoVigente();
        expect((await verificada(id))?.en).toBeNull();
        const antes = await verificada(id);
        const ahora = new Date("2026-10-29T15:00:00.000Z");

        const r = await verificacionCon({ ahora: () => ahora }).anotar(empresaId(e.empresa), id);
        expect(r).toEqual({ ok: true, valor: { cambio: true } });

        const despues = await verificada(id);
        expect(despues?.en?.getTime()).toBe(ahora.getTime());
        expect(despues?.estado).toBe("VIGENTE");
        expect(despues?.version).toBe((antes?.version ?? 0) + 1);
        const aud = await auditorias(e.empresa, id);
        expect(aud).toHaveLength(1);
        expect(aud[0]).toMatchObject({
          actor: null,
          antes: { autorizacion: "SIN_VERIFICAR" },
          despues: { autorizacion: "VERIFICADA", verificadaEn: ahora.toISOString() },
        });
        expect(campoConPosibleSecreto(aud[0]?.despues ?? null)).toBeNull();
        // La clave privada no está en ningún otro lado de la base: ni en la auditoría ni en los trabajos ni en el resto de las
        // columnas del certificado (solo en `clave_cifrada`, y cifrada).
        const volcado = await filas<{ t: string }>(
          `select to_jsonb(a)::text as t from auditoria_empresa a where empresa_id = $1
           union all select to_jsonb(t)::text from trabajo t where empresa_id = $1
           union all select (to_jsonb(c) - 'clave_cifrada')::text from certificado_arca c where id = $2`,
          [e.empresa, id],
        );
        expect(volcado.length).toBeGreaterThan(0);
        for (const { t } of volcado) {
          expect(t).not.toContain("PRIVATE");
          for (const clave of servicios.clavesGeneradas) {
            expect(t).not.toContain(clave.split("\n")[1] ?? "x".repeat(99));
          }
        }
      });

      it("repetir no cambia ni duplica: ni la hora, ni la versión, ni la auditoría", async () => {
        const { e, id } = await conCertificadoVigente();
        const primera = new Date("2026-10-29T15:00:00.000Z");
        const v = verificacionCon({ ahora: () => primera });
        expect(await v.anotar(empresaId(e.empresa), id)).toEqual({
          ok: true,
          valor: { cambio: true },
        });
        const fijada = await verificada(id);
        for (const minutos of [1, 60, 24 * 60]) {
          const despues = verificacionCon({
            ahora: () => new Date(primera.getTime() + minutos * 60_000),
          });
          expect(await despues.anotar(empresaId(e.empresa), id)).toEqual({
            ok: true,
            valor: { cambio: false },
          });
        }
        expect(await verificada(id)).toEqual(fijada);
        expect(await auditorias(e.empresa, id)).toHaveLength(1);
      });

      it("de N llamadas simultáneas ('carrera'), una sola cambia el estado: una auditoría y la hora es la de la ganadora", async () => {
        for (let ronda = 0; ronda < 3; ronda++) {
          const { e, id } = await conCertificadoVigente();
          const horas = Array.from({ length: 8 }, (_, i) => new Date(Date.UTC(2026, 9, 29, 15, i)));
          barrera = crearBarrera(horas.length);
          let rs;
          try {
            rs = await Promise.all(
              horas.map((h) =>
                verificacionCon({ ahora: () => h }).anotar(empresaId(e.empresa), id),
              ),
            );
          } finally {
            barrera = null;
          }
          expect(
            rs.every((r) => r.ok),
            JSON.stringify(rs),
          ).toBe(true);
          const ganadoras = rs.flatMap((r, i) => (r.ok && r.valor.cambio ? [i] : []));
          expect(ganadoras).toHaveLength(1);
          expect((await verificada(id))?.en?.getTime()).toBe(horas[ganadoras[0] ?? 0]?.getTime());
          expect(await auditorias(e.empresa, id)).toHaveLength(1);
        }
      });

      it("solo el certificado VIGENTE: un pedido sin cargar, un reemplazado o uno que no existe no cambian", async () => {
        const a = await conCertificadoVigente();
        // Un pedido todavía sin certificado.
        const pendiente = pedidoDeCertificado(a.e, { cuitTitular: cuitConPrefijo("20") });
        await casos.generarPedidoDeCertificado(a.e.como(new Date()), pendiente);
        // Un reemplazado: se carga otro para el mismo emisor y ambiente.
        const otro = pedidoDeCertificado(a.e, { cuitTitular: cuitConPrefijo("27") });
        const pedidoOtro = await casos.generarPedidoDeCertificado(a.e.como(new Date()), otro);
        if (!pedidoOtro.ok) throw new Error("pedido");
        await casos.cargarCertificado(a.e.como(new Date()), {
          certificadoId: certificadoId(otro.id),
          certificadoPem: await certificadoDeArca(
            servicios,
            "HOMOLOGACION",
            pedidoOtro.valor.pedidoPem,
          ),
        });
        expect((await verificada(a.id))?.estado).toBe("REEMPLAZADO");

        const v = verificacionCon({ ahora: () => new Date() });
        for (const id of [pendiente.id, a.id, randomUUID()]) {
          expect(await v.anotar(empresaId(a.e.empresa), id)).toEqual({
            ok: true,
            valor: { cambio: false },
          });
          expect((await verificada(id))?.en ?? null).toBeNull();
        }
        expect(await auditorias(a.e.empresa, a.id)).toHaveLength(0);
        // El vigente (el otro) sigue pudiendo verificarse.
        expect(await v.anotar(empresaId(a.e.empresa), otro.id)).toEqual({
          ok: true,
          valor: { cambio: true },
        });
      });

      it("aislamiento: una empresa no puede verificar el certificado de otra", async () => {
        const a = await conCertificadoVigente();
        const b = await conCertificadoVigente();
        const v = verificacionCon({ ahora: () => new Date() });
        expect(await v.anotar(empresaId(b.e.empresa), a.id)).toEqual({
          ok: true,
          valor: { cambio: false },
        });
        expect((await verificada(a.id))?.en ?? null).toBeNull();
        expect(await auditorias(a.e.empresa, a.id)).toHaveLength(0);
        expect(await auditorias(b.e.empresa, a.id)).toHaveLength(0);
        // El de cada una, en su empresa, sí.
        expect(await v.anotar(empresaId(a.e.empresa), a.id)).toEqual({
          ok: true,
          valor: { cambio: true },
        });
        expect((await verificada(b.id))?.en ?? null).toBeNull();
      });

      it("la base no deja pisar ni borrar una verificación ya anotada (ni siquiera el dueño de la base)", async () => {
        const { e, id } = await conCertificadoVigente();
        await verificacionCon({ ahora: () => new Date() }).anotar(empresaId(e.empresa), id);
        for (const nuevo of ["now() + interval '1 day'", "null"]) {
          await expect(
            dueno.query(
              `update certificado_arca set autorizacion_verificada_en = ${nuevo} where id = $1`,
              [id],
            ),
          ).rejects.toMatchObject({ constraint: "certificado_inmutable" });
        }
      });
    });

    // ===============================================================================================
    describe("el adaptador real de ARCA anota la verificación en la primera llamada exitosa", () => {
      const AMBIENTE = "HOMOLOGACION" as const;
      const TOKEN_600 = (codigo: string, texto: string) =>
        respuestaHttp(
          `<soap:Envelope xmlns:soap="x"><soap:Body><FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><Errors><Err><Code>${codigo}</Code><Msg>${texto}</Msg></Err></Errors></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`,
        );

      /** El adaptador con credenciales, almacén y verificación REALES (la base), y un ticket ya guardado del certificado vigente. */
      async function armar(
        e: Awaited<ReturnType<typeof conCertificadoVigente>>,
        transporte: Transporte,
      ) {
        const reloj = new RelojDeCertificados(new Date());
        const almacen = almacenDe(entorno, servicios, reloj);
        const empresa = empresaId(e.e.empresa);
        const emisor = emisorId(e.e.emisor);
        const guardado = await almacen.guardar(empresa, emisor, AMBIENTE, "wsfe", {
          certificadoId: e.id,
          token: new Secreto("TOKEN-DE-PRUEBA-D42"),
          firma: new Secreto("FIRMA-DE-PRUEBA-D42"),
          generadoEn: reloj.ahora(),
          venceEn: new Date(reloj.ahora().getTime() + 12 * 3_600_000),
        });
        expect(guardado.ok).toBe(true);
        const adaptador = crearEmisionArca(
          {
            credenciales: credencialesDe(entorno, servicios, reloj),
            tickets: almacen,
            verificacion: verificacionCon(reloj),
            transporte,
            reloj,
            esperar: () => Promise.resolve(),
          },
          empresa,
          emisor,
          AMBIENTE,
        );
        const cuit = cuitDesdeTexto(e.e.cuit);
        if (!cuit.ok) throw new Error("CUIT de la empresa de prueba");
        return { adaptador, reloj, punto: { cuit: cuit.valor, numero: 1 } };
      }
      const ultimo = grabacion(1, "024", "respuesta");

      it("antes de la primera llamada exitosa queda sin verificar; la llamada exitosa la anota, y las siguientes no cambian nada", async () => {
        const c = await conCertificadoVigente();
        const falso = new TransporteFalso().programar(
          "FECompUltimoAutorizado",
          respuestaHttp(ultimo),
        );
        const { adaptador, reloj, punto } = await armar(c, falso.transporte);
        expect((await verificada(c.id))?.en).toBeNull();

        expect(await adaptador.ultimoAutorizado(punto, "FACTURA_B")).toEqual({
          ok: true,
          valor: 13n,
        });
        const fijada = await verificada(c.id);
        expect(fijada?.en?.getTime()).toBe(reloj.ahora().getTime());
        expect(await auditorias(c.e.empresa, c.id)).toHaveLength(1);

        reloj.avanzar(60 * 60_000);
        expect(await adaptador.ultimoAutorizado(punto, "FACTURA_B")).toEqual({
          ok: true,
          valor: 13n,
        });
        expect(await verificada(c.id)).toEqual(fijada);
        expect(await auditorias(c.e.empresa, c.id)).toHaveLength(1);
      });

      it("si ARCA responde que no está autorizado (600 o 601, WSFE v4.8), el error se devuelve y NO se verifica; con la autorización creada, la siguiente llamada sí", async () => {
        const c = await conCertificadoVigente();
        const falso = new TransporteFalso().programar(
          "FECompUltimoAutorizado",
          TOKEN_600(
            "600",
            "ValidacionDeToken: No apareció CUIT en lista de relaciones: 23000000000",
          ),
          TOKEN_600("601", "CUIT representada no incluida en token."),
          respuestaHttp(ultimo),
        );
        const { adaptador, punto } = await armar(c, falso.transporte);
        for (const codigo of ["600", "601"]) {
          const r = await adaptador.ultimoAutorizado(punto, "FACTURA_B");
          expect(r).toEqual({
            ok: false,
            error: {
              codigo: "AUTORIZACION_DEL_SERVICIO_FALTANTE",
              detalle: `ARCA no aceptó el token (error ${codigo})`,
            },
          });
          expect((await verificada(c.id))?.en).toBeNull();
        }
        expect((await adaptador.ultimoAutorizado(punto, "FACTURA_B")).ok).toBe(true);
        expect((await verificada(c.id))?.en).not.toBeNull();
      });

      it("varias llamadas exitosas a la vez: un solo cambio de estado y una sola auditoría", async () => {
        const c = await conCertificadoVigente();
        const falso = new TransporteFalso().programar(
          "FECompUltimoAutorizado",
          respuestaHttp(ultimo),
        );
        const { adaptador, punto } = await armar(c, falso.transporte);
        barrera = crearBarrera(6);
        let rs;
        try {
          rs = await Promise.all(
            Array.from({ length: 6 }, () => adaptador.ultimoAutorizado(punto, "FACTURA_B")),
          );
        } finally {
          barrera = null;
        }
        expect(rs.every((r) => r.ok)).toBe(true);
        expect(falso.veces("FECompUltimoAutorizado")).toBe(6);
        expect(await auditorias(c.e.empresa, c.id)).toHaveLength(1);
        expect((await verificada(c.id))?.en).not.toBeNull();
      });

      it("se verifica el certificado que pidió el ticket, no el que sea el vigente cuando vuelve la respuesta", async () => {
        const c = await conCertificadoVigente();
        const falso = new TransporteFalso().programar(
          "FECompUltimoAutorizado",
          respuestaHttp(ultimo),
        );
        // Mientras ARCA «contesta», el gerente carga un certificado nuevo que reemplaza al que pidió el ticket.
        let nuevo: { id: string } | null = null;
        const conReemplazo: Transporte = async (pedido) => {
          const entrada = pedidoDeCertificado(c.e, { cuitTitular: cuitConPrefijo("27") });
          const p = await casos.generarPedidoDeCertificado(c.e.como(new Date()), entrada);
          if (!p.ok) throw new Error("pedido");
          const carga = await casos.cargarCertificado(c.e.como(new Date()), {
            certificadoId: certificadoId(entrada.id),
            certificadoPem: await certificadoDeArca(servicios, "HOMOLOGACION", p.valor.pedidoPem),
          });
          if (!carga.ok) throw new Error("carga");
          nuevo = { id: entrada.id };
          return falso.transporte(pedido);
        };
        const { adaptador, punto } = await armar(c, conReemplazo);
        expect((await adaptador.ultimoAutorizado(punto, "FACTURA_B")).ok).toBe(true);
        expect((nuevo as { id: string } | null)?.id).toBeDefined();
        // El viejo ya era REEMPLAZADO: no se verifica; el nuevo (que nadie llamó a ARCA con él) sigue sin verificar.
        expect(await verificada(c.id)).toMatchObject({ estado: "REEMPLAZADO", en: null });
        expect((await verificada((nuevo as unknown as { id: string }).id))?.en).toBeNull();
        expect(await auditorias(c.e.empresa, c.id)).toHaveLength(0);
      });

      it("si no se puede anotar (la base no responde), la respuesta de ARCA se devuelve igual", async () => {
        const c = await conCertificadoVigente();
        const falso = new TransporteFalso().programar(
          "FECompUltimoAutorizado",
          respuestaHttp(ultimo),
        );
        const { adaptador, reloj, punto } = await armar(c, falso.transporte);
        const roto = crearEmisionArca(
          {
            credenciales: credencialesDe(entorno, servicios, reloj),
            tickets: almacenDe(entorno, servicios, reloj),
            verificacion: {
              anotar: () => Promise.reject(new Error("conexión perdida con postgres://secreto")),
            },
            transporte: falso.transporte,
            reloj,
            esperar: () => Promise.resolve(),
          },
          empresaId(c.e.empresa),
          emisorId(c.e.emisor),
          AMBIENTE,
        );
        expect(await roto.ultimoAutorizado(punto, "FACTURA_B")).toEqual({ ok: true, valor: 13n });
        expect((await verificada(c.id))?.en).toBeNull();
        // Y la próxima llamada, con la base de vuelta, lo anota.
        expect((await adaptador.ultimoAutorizado(punto, "FACTURA_B")).ok).toBe(true);
        expect((await verificada(c.id))?.en).not.toBeNull();
      });
    });
  },
);
