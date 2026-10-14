import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { crearCifradorAesGcm } from "../../src/adaptadores/cifrado/aes-gcm";
import { certificadoId, dondeSeGuardaLaCredencial } from "../../src/modulos/fiscal/publico";
import { emisorId, empresaId } from "../../src/primitivas/identificadores/marca";
import { Secreto } from "../../src/primitivas/secreto/secreto";
import type { TicketDeAcceso } from "../../src/puertos/almacen-de-tickets";
import { campoConPosibleSecreto, type Dato } from "../../src/puertos/sin-secretos";
import { crearBaseAparte } from "./entorno";
import {
  RelojDeCertificados,
  almacenDe,
  casosDeCertificados,
  certificadoDeArca,
  clavesMaestrasDePrueba,
  credencialesDe,
  crearEntornoDeCertificados,
  crearServicios,
  escenarioDeCertificados,
  pedidoDeCertificado,
  type ServiciosDePrueba,
} from "./certificados-apoyo";

/**
 * H7 facturación, tramo F7: las credenciales de un emisor (certificado y clave descifrada SOLO en memoria) y el
 * almacén del ticket de acceso (guardado cifrado, único por (emisor, ambiente, servicio), con vencimiento) contra una
 * base real. Es lo que consume el adaptador de ARCA (F8). Todo lo secreto viaja envuelto y no aparece en ninguna
 * respuesta, error, auditoría ni columna que no sea la cifrada.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

type Fila = Record<string, unknown>;
const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const TOKEN = "PD94bWwgdmVyc2lvbj0iMS4wIj8-token-de-prueba-0123456789";
const FIRMA = "c2lnbi1kZS1wcnVlYmEtQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=";

describe.skipIf(base === null)(
  "certificados F7: credenciales de emisor y tickets de acceso",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: ReturnType<typeof crearEntornoDeCertificados>;
    let servicios: ServiciosDePrueba;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDeCertificados(propia.base, 8);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      servicios = await crearServicios();
    }, 120_000);
    afterAll(async () => {
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    });

    const filas = async <T extends Fila = Fila>(texto: string, p: unknown[] = []) =>
      (await dueno.query<T>(texto, p)).rows;

    /** Una empresa con un certificado VIGENTE cargado de verdad (pedido, certificado de la autoridad y carga). */
    async function conCertificado(ambiente: "HOMOLOGACION" | "PRODUCCION" = "HOMOLOGACION") {
      const e = await escenarioDeCertificados(dueno, propia.base);
      const casos = casosDeCertificados(entorno, servicios);
      const reloj = new RelojDeCertificados(new Date());
      const cargar = async (alias?: string) => {
        const entrada = pedidoDeCertificado(e, {
          ambiente,
          ...(alias === undefined ? {} : { alias }),
        });
        const pedido = await casos.generarPedidoDeCertificado(e.como(reloj.ahora()), entrada);
        if (!pedido.ok) throw new Error(`pedido: ${JSON.stringify(pedido.error)}`);
        const pem = await certificadoDeArca(servicios, ambiente, pedido.valor.pedidoPem);
        const carga = await casos.cargarCertificado(e.como(reloj.ahora()), {
          certificadoId: certificadoId(entrada.id),
          certificadoPem: pem,
        });
        if (!carga.ok) throw new Error(`carga: ${JSON.stringify(carga.error)}`);
        return {
          id: entrada.id,
          pem,
          clave: servicios.clavesGeneradas.at(-1) ?? "",
          vence: carga.valor.vence,
        };
      };
      return { e, casos, reloj, cargar, emisor: emisorId(e.emisor), empresa: empresaId(e.empresa) };
    }

    const ticket = (
      certificado: string,
      cambios: Partial<TicketDeAcceso> = {},
      desde = new Date(),
    ): TicketDeAcceso => ({
      certificadoId: certificado,
      token: new Secreto(TOKEN),
      firma: new Secreto(FIRMA),
      generadoEn: desde,
      venceEn: new Date(desde.getTime() + 12 * HORA),
      ...cambios,
    });

    const sinSecretos = (dato: unknown) => {
      const texto = JSON.stringify(dato);
      for (const secreto of [
        TOKEN,
        FIRMA,
        ...servicios.clavesGeneradas.map((c) => c.split("\n")[1] ?? "?"),
      ]) {
        expect(texto).not.toContain(secreto);
      }
      expect(texto).not.toContain("PRIVATE");
    };

    // ===============================================================================================
    describe("credenciales de emisor", () => {
      it("devuelve el certificado vigente y su clave descifrada, envuelta; la clave sale igual a la generada", async () => {
        const c = await conCertificado();
        const cargado = await c.cargar();
        const credenciales = credencialesDe(entorno, servicios, c.reloj);
        const r = await credenciales.obtener(c.empresa, c.emisor, "HOMOLOGACION");
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.valor.certificadoId).toBe(cargado.id);
        expect(r.valor.certificadoPem).toBe(cargado.pem);
        expect(r.valor.venceEn).toEqual(cargado.vence);
        expect(r.valor.clavePrivada.revelar()).toBe(cargado.clave);
        // Envuelta: serializar la respuesta entera no muestra la clave.
        sinSecretos(r);
        expect(JSON.stringify(r.valor)).toContain("[secreto]");
        // La clave corresponde al certificado (es la que generó el pedido).
        expect(
          servicios.lector.correspondeALaClave(r.valor.certificadoPem, r.valor.clavePrivada),
        ).toBe(true);
      });

      it("sin certificado vigente (o de otro ambiente, o de otro emisor): SIN_CERTIFICADO_VIGENTE", async () => {
        const sin = await conCertificado();
        const credenciales = credencialesDe(entorno, servicios, sin.reloj);
        expect(await credenciales.obtener(sin.empresa, sin.emisor, "HOMOLOGACION")).toEqual({
          ok: false,
          error: "SIN_CERTIFICADO_VIGENTE",
        });
        await sin.cargar();
        expect((await credenciales.obtener(sin.empresa, sin.emisor, "HOMOLOGACION")).ok).toBe(true);
        expect(await credenciales.obtener(sin.empresa, sin.emisor, "PRODUCCION")).toEqual({
          ok: false,
          error: "SIN_CERTIFICADO_VIGENTE",
        });
        expect(
          await credenciales.obtener(sin.empresa, emisorId(randomUUID()), "HOMOLOGACION"),
        ).toEqual({
          ok: false,
          error: "SIN_CERTIFICADO_VIGENTE",
        });
      });

      it("el certificado de una empresa no lo obtiene otra, ni con su emisor", async () => {
        const a = await conCertificado();
        const b = await conCertificado();
        await a.cargar();
        const credenciales = credencialesDe(entorno, servicios, a.reloj);
        expect(await credenciales.obtener(b.empresa, a.emisor, "HOMOLOGACION")).toEqual({
          ok: false,
          error: "SIN_CERTIFICADO_VIGENTE",
        });
        expect(await credenciales.obtener(a.empresa, b.emisor, "HOMOLOGACION")).toEqual({
          ok: false,
          error: "SIN_CERTIFICADO_VIGENTE",
        });
      });

      it("un certificado vencido: CERTIFICADO_VENCIDO (se calcula con la hora, en el instante exacto ya venció)", async () => {
        const c = await conCertificado();
        const cargado = await c.cargar();
        const credenciales = credencialesDe(entorno, servicios, c.reloj);
        c.reloj.actual = new Date(cargado.vence.getTime() - 1);
        expect((await credenciales.obtener(c.empresa, c.emisor, "HOMOLOGACION")).ok).toBe(true);
        c.reloj.actual = cargado.vence;
        expect(await credenciales.obtener(c.empresa, c.emisor, "HOMOLOGACION")).toEqual({
          ok: false,
          error: "CERTIFICADO_VENCIDO",
        });
      });

      it("con otra clave maestra la clave no se descifra: CLAVE_ILEGIBLE, sin la clave en el error", async () => {
        const c = await conCertificado();
        await c.cargar();
        const otra = {
          cifrador: crearCifradorAesGcm({ activa: clavesMaestrasDePrueba(servicios.maestra.kid) }),
        };
        const r = await credencialesDe(entorno, otra, c.reloj).obtener(
          c.empresa,
          c.emisor,
          "HOMOLOGACION",
        );
        expect(r).toEqual({ ok: false, error: "CLAVE_ILEGIBLE" });
        sinSecretos(r);
      });

      it("tras reemplazar el certificado, las credenciales son las del nuevo (con su propia clave)", async () => {
        const c = await conCertificado();
        const primero = await c.cargar();
        const segundo = await c.cargar();
        const r = await credencialesDe(entorno, servicios, c.reloj).obtener(
          c.empresa,
          c.emisor,
          "HOMOLOGACION",
        );
        expect(r.ok && r.valor.certificadoId).toBe(segundo.id);
        expect(r.ok && r.valor.clavePrivada.revelar()).toBe(segundo.clave);
        expect(segundo.clave).not.toBe(primero.clave);
      });

      it("la clave se descifra con la clave maestra vigente y con la anterior (rotación: se leen dos versiones)", async () => {
        const c = await conCertificado();
        const cargado = await c.cargar();
        const nueva = clavesMaestrasDePrueba("prueba-2");
        const rotado = crearCifradorAesGcm({ activa: nueva, anteriores: [servicios.maestra] });
        const r = await credencialesDe(entorno, { cifrador: rotado }, c.reloj).obtener(
          c.empresa,
          c.emisor,
          "HOMOLOGACION",
        );
        expect(r.ok && r.valor.clavePrivada.revelar()).toBe(cargado.clave);
      });
    });

    // ===============================================================================================
    describe("almacén de tickets de acceso", () => {
      it("guarda el ticket cifrado (ni el token ni la firma en claro en la base) y lo devuelve envuelto", async () => {
        const c = await conCertificado();
        const { id } = await c.cargar();
        const almacen = almacenDe(entorno, servicios, c.reloj);
        expect(await almacen.leer(c.empresa, c.emisor, "HOMOLOGACION", "wsfe")).toEqual({
          ok: true,
          valor: null,
        });

        const t = ticket(id, {}, c.reloj.ahora());
        expect(await almacen.guardar(c.empresa, c.emisor, "HOMOLOGACION", "wsfe", t)).toEqual({
          ok: true,
          valor: null,
        });

        const r = await almacen.leer(c.empresa, c.emisor, "HOMOLOGACION", "wsfe");
        expect(r.ok).toBe(true);
        if (!r.ok || r.valor === null) throw new Error("el ticket no volvió");
        expect(r.valor.certificadoId).toBe(id);
        expect(r.valor.token.revelar()).toBe(TOKEN);
        expect(r.valor.firma.revelar()).toBe(FIRMA);
        expect(r.valor.generadoEn).toEqual(t.generadoEn);
        expect(r.valor.venceEn).toEqual(t.venceEn);
        sinSecretos(r);

        // En la base: cifrado, atado a su fila y sin rastro del texto en claro.
        const fila = (
          await filas<{ c: Buffer; kid: string; n: Buffer; e: Buffer }>(
            `select credencial_cifrada as c, credencial_kid as kid, credencial_nonce as n, credencial_etiqueta as e
           from acceso_arca where certificado_id = $1 and servicio = 'wsfe'`,
            [id],
          )
        )[0];
        expect(fila?.kid).toBe(servicios.maestra.kid);
        expect(fila?.c.toString("latin1")).not.toContain(TOKEN.slice(0, 20));
        expect(fila?.c.toString("latin1")).not.toContain(FIRMA.slice(0, 20));
        const lugar = dondeSeGuardaLaCredencial(c.empresa, certificadoId(id), "wsfe");
        const texto = {
          cifrado: fila?.c ?? Buffer.alloc(0),
          nonce: fila?.n ?? Buffer.alloc(0),
          etiqueta: fila?.e ?? Buffer.alloc(0),
          kid: fila?.kid ?? "",
        };
        expect(servicios.cifrador.descifrar(texto, lugar)).not.toBeNull();
        expect(
          servicios.cifrador.descifrar(texto, { ...lugar, filaId: `${randomUUID()}:wsfe` }),
        ).toBeNull();
        expect(
          servicios.cifrador.descifrar(texto, { ...lugar, columna: "clave_cifrada" }),
        ).toBeNull();
      });

      it("no hay secretos en ninguna otra parte de la base (la auditoría, los trabajos, las demás columnas)", async () => {
        const c = await conCertificado();
        const { id } = await c.cargar();
        const almacen = almacenDe(entorno, servicios, c.reloj);
        await almacen.guardar(
          c.empresa,
          c.emisor,
          "HOMOLOGACION",
          "wsfe",
          ticket(id, {}, c.reloj.ahora()),
        );
        const volcado = await filas<{ t: string }>(
          `select to_jsonb(a)::text as t from auditoria_empresa a where empresa_id = $1
         union all select to_jsonb(t)::text from trabajo t where empresa_id = $1
         union all select (to_jsonb(x) - 'credencial_cifrada')::text from acceso_arca x where empresa_id = $1
         union all select (to_jsonb(k) - 'clave_cifrada')::text from certificado_arca k where empresa_id = $1`,
          [c.e.empresa],
        );
        expect(volcado.length).toBeGreaterThan(0);
        for (const { t } of volcado) {
          expect(t).not.toContain(TOKEN.slice(0, 20));
          expect(t).not.toContain(FIRMA.slice(0, 20));
          expect(t).not.toContain("PRIVATE");
        }
      });

      it("audita el hecho (certificado, servicio, ambiente y vencimiento) sin el contenido, en la misma transacción", async () => {
        const c = await conCertificado();
        const { id } = await c.cargar();
        const almacen = almacenDe(entorno, servicios, c.reloj);
        const t = ticket(id, {}, c.reloj.ahora());
        await almacen.guardar(c.empresa, c.emisor, "HOMOLOGACION", "wsfe", t);
        const aud = await filas<{ accion: string; actor: string | null; despues: Dato }>(
          "select accion, actor_persona_id as actor, despues from auditoria_empresa where empresa_id = $1 and accion = 'ACCESO_ARCA_RENOVADO'",
          [c.e.empresa],
        );
        expect(aud).toEqual([
          {
            accion: "ACCESO_ARCA_RENOVADO",
            actor: null,
            despues: {
              servicio: "wsfe",
              ambiente: "HOMOLOGACION",
              generadoEn: t.generadoEn.toISOString(),
              vence: t.venceEn.toISOString(),
            },
          },
        ]);
        expect(campoConPosibleSecreto(aud[0]?.despues ?? null)).toBeNull();
      });

      it("sirve hasta 5 minutos antes de vencer: antes del margen lo devuelve, en el margen no", async () => {
        const c = await conCertificado();
        const { id } = await c.cargar();
        const almacen = almacenDe(entorno, servicios, c.reloj);
        const t = ticket(id, {}, c.reloj.ahora());
        await almacen.guardar(c.empresa, c.emisor, "HOMOLOGACION", "wsfe", t);
        const margen = t.venceEn.getTime() - 5 * MINUTO;
        for (const [ms, sirve] of [
          [margen - 1, true],
          [margen, false],
          [margen + 1, false],
          [t.venceEn.getTime() + 1, false],
        ] as const) {
          c.reloj.actual = new Date(ms);
          const r = await almacen.leer(c.empresa, c.emisor, "HOMOLOGACION", "wsfe");
          expect(r.ok && r.valor !== null, `a ${ms - margen} ms del margen`).toBe(sirve);
        }
      });

      it("guardar el mismo ticket dos veces no escribe ni audita otra vez; uno más viejo no pisa a uno más nuevo; uno más nuevo sí", async () => {
        const c = await conCertificado();
        const { id } = await c.cargar();
        const almacen = almacenDe(entorno, servicios, c.reloj);
        const desde = c.reloj.ahora();
        const auditadas = async () =>
          (
            await filas(
              "select 1 from auditoria_empresa where empresa_id = $1 and accion = 'ACCESO_ARCA_RENOVADO'",
              [c.e.empresa],
            )
          ).length;
        const guardar = (t: TicketDeAcceso) =>
          almacen.guardar(c.empresa, c.emisor, "HOMOLOGACION", "wsfe", t);
        const leer = async () => {
          const r = await almacen.leer(c.empresa, c.emisor, "HOMOLOGACION", "wsfe");
          return r.ok && r.valor !== null ? r.valor.token.revelar() : null;
        };

        await guardar(ticket(id, { token: new Secreto("A") }, desde));
        await guardar(ticket(id, { token: new Secreto("A") }, desde));
        expect(await auditadas()).toBe(1);
        // Uno viejo (generado antes) o distinto con la misma generación no pisa.
        await guardar(
          ticket(id, { token: new Secreto("VIEJO") }, new Date(desde.getTime() - MINUTO)),
        );
        await guardar(ticket(id, { token: new Secreto("OTRO") }, desde));
        expect(await leer()).toBe("A");
        expect(await auditadas()).toBe(1);
        // Uno nuevo sí: el ticket se renueva en el lugar.
        await guardar(ticket(id, { token: new Secreto("B") }, new Date(desde.getTime() + MINUTO)));
        expect(await leer()).toBe("B");
        expect(await auditadas()).toBe(2);
        expect(
          await filas("select 1 from acceso_arca where certificado_id = $1", [id]),
        ).toHaveLength(1);
      });

      it("al reemplazar el certificado el ticket nuevo es del nuevo; el del viejo no se lee más (otro certificado, otro ticket)", async () => {
        const c = await conCertificado();
        const viejo = await c.cargar();
        const almacen = almacenDe(entorno, servicios, c.reloj);
        await almacen.guardar(
          c.empresa,
          c.emisor,
          "HOMOLOGACION",
          "wsfe",
          ticket(viejo.id, { token: new Secreto("DEL-VIEJO") }, c.reloj.ahora()),
        );
        const nuevo = await c.cargar();
        expect(await almacen.leer(c.empresa, c.emisor, "HOMOLOGACION", "wsfe")).toEqual({
          ok: true,
          valor: null,
        });
        await almacen.guardar(
          c.empresa,
          c.emisor,
          "HOMOLOGACION",
          "wsfe",
          ticket(nuevo.id, { token: new Secreto("DEL-NUEVO") }, c.reloj.ahora()),
        );
        const r = await almacen.leer(c.empresa, c.emisor, "HOMOLOGACION", "wsfe");
        expect(r.ok && r.valor?.token.revelar()).toBe("DEL-NUEVO");
        // Un ticket que llega tarde del certificado viejo se guarda con el viejo y no pisa al nuevo.
        await almacen.guardar(
          c.empresa,
          c.emisor,
          "HOMOLOGACION",
          "wsfe",
          ticket(
            viejo.id,
            { token: new Secreto("TARDE") },
            new Date(c.reloj.ahora().getTime() + MINUTO),
          ),
        );
        const despues = await almacen.leer(c.empresa, c.emisor, "HOMOLOGACION", "wsfe");
        expect(despues.ok && despues.valor?.token.revelar()).toBe("DEL-NUEVO");
      });

      it("un ticket de un certificado que no es de ese emisor y ambiente, que no existe o que todavía es un pedido: CERTIFICADO_NO_ENCONTRADO", async () => {
        const c = await conCertificado();
        const otra = await conCertificado();
        const propio = await c.cargar();
        const ajeno = await otra.cargar();
        const almacen = almacenDe(entorno, servicios, c.reloj);
        const guardar = (
          empresa: typeof c.empresa,
          emisor: typeof c.emisor,
          ambiente: "HOMOLOGACION" | "PRODUCCION",
          certificado: string,
        ) =>
          almacen.guardar(
            empresa,
            emisor,
            ambiente,
            "wsfe",
            ticket(certificado, {}, c.reloj.ahora()),
          );
        const NO = { ok: false, error: "CERTIFICADO_NO_ENCONTRADO" };
        expect(await guardar(c.empresa, c.emisor, "HOMOLOGACION", randomUUID())).toEqual(NO);
        expect(await guardar(c.empresa, c.emisor, "PRODUCCION", propio.id)).toEqual(NO);
        expect(
          await guardar(c.empresa, emisorId(otra.e.emisor), "HOMOLOGACION", propio.id),
        ).toEqual(NO);
        expect(await guardar(c.empresa, c.emisor, "HOMOLOGACION", ajeno.id)).toEqual(NO);
        // Otra empresa tampoco lo ve.
        expect(await guardar(otra.empresa, otra.emisor, "HOMOLOGACION", propio.id)).toEqual(NO);
        // Un pedido sin certificado no pide tickets.
        const pedido = pedidoDeCertificado(c.e);
        await c.casos.generarPedidoDeCertificado(c.e.como(c.reloj.ahora()), pedido);
        expect(await guardar(c.empresa, c.emisor, "HOMOLOGACION", pedido.id)).toEqual(NO);
        expect(
          await filas("select 1 from acceso_arca where empresa_id = $1", [c.e.empresa]),
        ).toHaveLength(0);
      });

      it("un ticket alterado o movido de fila en la base no se lee: TICKET_ILEGIBLE (sin repetir su contenido)", async () => {
        const c = await conCertificado();
        const uno = await c.cargar();
        const almacen = almacenDe(entorno, servicios, c.reloj);
        await almacen.guardar(
          c.empresa,
          c.emisor,
          "HOMOLOGACION",
          "wsfe",
          ticket(uno.id, {}, c.reloj.ahora()),
        );
        // Un ticket de OTRO emisor (otra empresa) cuyo texto cifrado se copia a la fila del primero.
        const otra = await conCertificado();
        const dos = await otra.cargar();
        await almacenDe(entorno, servicios, otra.reloj).guardar(
          otra.empresa,
          otra.emisor,
          "HOMOLOGACION",
          "wsfe",
          ticket(dos.id, { token: new Secreto("DE-OTRA-EMPRESA") }, otra.reloj.ahora()),
        );
        await dueno.query(
          `update acceso_arca set credencial_cifrada = o.credencial_cifrada, credencial_nonce = o.credencial_nonce,
                credencial_etiqueta = o.credencial_etiqueta, credencial_kid = o.credencial_kid
           from acceso_arca o where acceso_arca.certificado_id = $1 and o.certificado_id = $2`,
          [uno.id, dos.id],
        );
        const r = await almacen.leer(c.empresa, c.emisor, "HOMOLOGACION", "wsfe");
        expect(r).toEqual({ ok: false, error: "TICKET_ILEGIBLE" });
        sinSecretos(r);
        expect(JSON.stringify(r)).not.toContain("DE-OTRA-EMPRESA");
      });

      it("con otra clave maestra el ticket no se lee: TICKET_ILEGIBLE", async () => {
        const c = await conCertificado();
        const { id } = await c.cargar();
        await almacenDe(entorno, servicios, c.reloj).guardar(
          c.empresa,
          c.emisor,
          "HOMOLOGACION",
          "wsfe",
          ticket(id, {}, c.reloj.ahora()),
        );
        const otra = {
          cifrador: crearCifradorAesGcm({ activa: clavesMaestrasDePrueba(servicios.maestra.kid) }),
        };
        expect(
          await almacenDe(entorno, otra, c.reloj).leer(c.empresa, c.emisor, "HOMOLOGACION", "wsfe"),
        ).toEqual({ ok: false, error: "TICKET_ILEGIBLE" });
      });

      it("el ticket de una empresa no lo lee otra", async () => {
        const a = await conCertificado();
        const b = await conCertificado();
        const { id } = await a.cargar();
        await almacenDe(entorno, servicios, a.reloj).guardar(
          a.empresa,
          a.emisor,
          "HOMOLOGACION",
          "wsfe",
          ticket(id, {}, a.reloj.ahora()),
        );
        const almacen = almacenDe(entorno, servicios, a.reloj);
        expect(await almacen.leer(b.empresa, a.emisor, "HOMOLOGACION", "wsfe")).toEqual({
          ok: true,
          valor: null,
        });
        expect((await almacen.leer(a.empresa, a.emisor, "HOMOLOGACION", "wsfe")).ok).toBe(true);
      });

      it("un fallo de conexión (un rol que no existe) no deja el ticket ni la clave en el error", async () => {
        const c = await conCertificado();
        const { id } = await c.cargar();
        const url = new URL(propia.base.app);
        url.username = `rol_que_no_existe_${randomUUID().slice(0, 8)}`;
        const roto = crearEntornoDeCertificados({ ...propia.base, app: url.toString() }, 2);
        try {
          const almacen = almacenDe(roto, servicios, c.reloj);
          const resultado = await almacen
            .guardar(c.empresa, c.emisor, "HOMOLOGACION", "wsfe", ticket(id, {}, c.reloj.ahora()))
            .then(
              (r) => r,
              (e: unknown) => ({
                lanzado: e instanceof Error ? `${e.name}: ${e.message}` : "no es un Error",
              }),
            );
          sinSecretos(resultado);
          const credenciales = await credencialesDe(roto, servicios, c.reloj)
            .obtener(c.empresa, c.emisor, "HOMOLOGACION")
            .then(
              (r) => r,
              (e: unknown) => ({
                lanzado: e instanceof Error ? `${e.name}: ${e.message}` : "no es un Error",
              }),
            );
          sinSecretos(credenciales);
        } finally {
          await roto.cerrar();
        }
        expect(
          await filas("select 1 from acceso_arca where certificado_id = $1", [id]),
        ).toHaveLength(0);
      });
    });
  },
);
