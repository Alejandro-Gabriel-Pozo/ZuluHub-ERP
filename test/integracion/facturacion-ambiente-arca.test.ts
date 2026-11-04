import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { puntoDeVentaId } from "../../src/modulos/fiscal/publico";
import type { Cuit } from "../../src/primitivas/identificacion-fiscal/cuit";
import type { PuntoDeVentaDeArca } from "../../src/modulos/fiscal/dominio/habilitacion-en-arca";
import type { Resultado } from "../../src/primitivas/resultado/resultado";
import type { ErrorDeEmision } from "../../src/modulos/fiscal/casos-de-uso/emision-electronica";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { crearBarrera, crearBaseAparte } from "./entorno";
import {
  RelojDePrueba,
  cargarCertificado,
  casosDeFacturacion,
  crearEntornoDeFacturacion,
  crearEscenarioDeCasos,
  darDeAltaEnArca,
  type EscenarioDeCasos,
} from "./facturacion-casos-apoyo";

/**
 * D-77 (dueño, 2026-10-29): pasar un punto de venta a producción solo si ARCA lo tiene (existe, no está bloqueado ni dado de baja), contra
 * una base real con el rol limitado de la aplicación. ARCA es el falso: SIN VERIFICAR contra ARCA real (no hay grabación de
 * `FEParamGetPtosVenta`). Lo que se prueba acá y los repositorios en memoria no pueden: que la llamada a ARCA se hace sin ninguna
 * transacción abierta (lo mira `pg_stat_activity`), que un rechazo no deja nada escrito, que el cambio edita el punto de venta de verdad
 * (la versión de la base), y las carreras reales: dos pasajes a la vez y el cierre de la sucursal (que ordena el `FOR SHARE`, lo
 * confirma la propia base y no un reloj).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

type Fila = Record<string, unknown>;

/** El falso de ARCA que anota cuántas transacciones había abiertas al llamarlo y deja a la prueba hacer algo mientras «contesta». */
class ArcaMedida extends EmisionFalsa {
  readonly abiertasAlLlamar: number[] = [];
  /** Lo que pasa en el medio de la llamada (otro pedido, una edición, el cierre de la sucursal). */
  mientras: (() => Promise<void>) | null = null;
  /** Con `true`, no contesta nunca (lo corta el tiempo límite propio). */
  colgada = false;
  constructor(private readonly abiertas: () => Promise<number>) {
    super();
  }
  override async puntosDeVenta(
    cuit: Cuit,
  ): Promise<Resultado<readonly PuntoDeVentaDeArca[], ErrorDeEmision>> {
    this.abiertasAlLlamar.push(await this.abiertas());
    if (this.colgada) return new Promise(() => undefined);
    await this.mientras?.();
    return super.puntosDeVenta(cuit);
  }
}

describe.skipIf(base === null)(
  "D-77: pasar a producción verifica con ARCA, contra una base real",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let dueno: pg.Client;
    let entorno: ReturnType<typeof crearEntornoDeFacturacion>;
    /** Una pausa DENTRO de la transacción de escritura, justo después de leer la sucursal con `FOR SHARE`. */
    let trasLeerLaSucursal: (() => Promise<void>) | null = null;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entorno = crearEntornoDeFacturacion(propia.base, 12, (tx) => ({
        ...tx,
        sucursalBloqueada: {
          obtenerBloqueandoElCierre: async (...args) => {
            const r = await tx.sucursalBloqueada.obtenerBloqueandoElCierre(...args);
            await trasLeerLaSucursal?.();
            return r;
          },
        },
      }));
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
    }, 120_000);
    afterAll(async () => {
      trasLeerLaSucursal = null;
      await dueno.end();
      await entorno.cerrar();
      await propia.destruir();
    });

    const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
      (await dueno.query<T>(texto, parametros)).rows;
    const cuenta = async (texto: string, parametros: unknown[] = []) =>
      Number((await filas<{ n: string }>(texto, parametros))[0]?.n ?? 0);

    /** Cuántas transacciones tiene abiertas la aplicación en este momento (todas las conexiones menos la de la prueba). */
    const transaccionesAbiertas = () =>
      cuenta(
        `select count(*) as n from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid() and xact_start is not null
          and backend_type = 'client backend'`,
      );
    const estadoDelPunto = async (e: EscenarioDeCasos) =>
      (
        await filas<{ ambiente: string; version: number; numero: number }>(
          "select ambiente, version, numero from punto_de_venta where id = $1",
          [e.pv],
        )
      )[0];
    const cambiosDeAmbiente = (e: EscenarioDeCasos) =>
      cuenta(
        "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = 'PUNTO_DE_VENTA_AMBIENTE_CAMBIADO'",
        [e.empresa],
      );
    async function esperar(condicion: () => Promise<boolean>, que: string, ms = 15_000) {
      const hasta = Date.now() + ms;
      while (Date.now() < hasta) {
        if (await condicion()) return;
        await new Promise((r) => setTimeout(r, 40));
      }
      throw new Error(`no pasó a tiempo: ${que}`);
    }
    const esperandoBloqueo = async (patron: string) =>
      (await cuenta(
        `select count(*) as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock' and query ~* $1`,
        [patron],
      )) > 0;
    const terminado = (promesa: Promise<unknown>) => {
      const estado = { listo: false };
      void promesa.then(
        () => (estado.listo = true),
        () => (estado.listo = true),
      );
      return estado;
    };
    const unaConexion = async () => {
      const c = new pg.Client({ connectionString: propia.base.dueno });
      await c.connect();
      return c;
    };

    /** Un gerente, un punto de venta en pruebas con certificado de producción, y ARCA (falsa) que lo tiene dado de alta y habilitado. */
    async function preparar(
      opciones: Readonly<{ sinCertificadoDeProduccion?: boolean; enArca?: boolean }> = {},
    ) {
      const e = await crearEscenarioDeCasos(dueno, propia.base, { rol: "GERENTE" });
      if (opciones.sinCertificadoDeProduccion !== true) {
        await cargarCertificado(propia.base, e, "PRODUCCION");
      }
      const produccion = new ArcaMedida(transaccionesAbiertas);
      if (opciones.enArca !== false) darDeAltaEnArca(produccion, e);
      const reloj = new RelojDePrueba(new Date());
      const casos = casosDeFacturacion(
        entorno,
        { HOMOLOGACION: new EmisionFalsa(), PRODUCCION: produccion },
        reloj,
        {
          tiempos: {
            autorizarEnMs: 2_000,
            consultarEnMs: 2_000,
            ultimoAutorizadoEnMs: 2_000,
            puntosDeVentaEnMs: 400,
          },
        },
      );
      const inicial = await estadoDelPunto(e);
      const pasar = (versionEsperada = inicial?.version ?? 0) =>
        casos.cambiarAmbienteDePuntoDeVenta(e.como(reloj.ahora()), {
          puntoDeVentaId: puntoDeVentaId(e.pv),
          ambiente: "PRODUCCION",
          versionEsperada,
        });
      return { e, produccion, pasar, inicial };
    }

    /** Nada cambió: ni el punto de venta (ambiente y versión), ni la auditoría. */
    async function sinCambios(
      e: EscenarioDeCasos,
      inicial: Awaited<ReturnType<typeof preparar>>["inicial"],
    ) {
      expect(await estadoDelPunto(e)).toEqual(inicial);
      expect(await cambiosDeAmbiente(e)).toBe(0);
    }

    // ===============================================================================================
    describe("lo que pasa y lo que no", () => {
      it("existe y está habilitado: pasa; la base queda en PRODUCCION con UNA auditoría, y ARCA se llamó sin ninguna transacción abierta", async () => {
        const { e, produccion, pasar, inicial } = await preparar();
        expect(await pasar()).toEqual({ ok: true, valor: { yaEstaba: false } });
        expect(await estadoDelPunto(e)).toMatchObject({
          ambiente: "PRODUCCION",
          version: (inicial?.version ?? 0) + 1,
        });
        expect(await cambiosDeAmbiente(e)).toBe(1);
        const auditoria = (
          await filas<{ antes: Fila; despues: Fila; actor: string }>(
            `select antes, despues, actor_persona_id as actor from auditoria_empresa
            where empresa_id = $1 and accion = 'PUNTO_DE_VENTA_AMBIENTE_CAMBIADO'`,
            [e.empresa],
          )
        )[0];
        expect(auditoria).toEqual({
          antes: { ambiente: "HOMOLOGACION" },
          despues: { ambiente: "PRODUCCION", verificadoEnArca: true },
          actor: e.persona,
        });
        expect(produccion.consultasDePuntosDeVenta).toHaveLength(1);
        expect(produccion.abiertasAlLlamar).toEqual([0]);
      });

      it.each([
        ["ARCA no tiene el número", { enArca: false }, "PUNTO_DE_VENTA_NO_HABILITADO_EN_ARCA"],
        ["está bloqueado", { bloqueado: true }, "PUNTO_DE_VENTA_NO_HABILITADO_EN_ARCA"],
        ["está dado de baja", { dadoDeBaja: true }, "PUNTO_DE_VENTA_NO_HABILITADO_EN_ARCA"],
      ] as const)(
        "%s: se rechaza y no se cambia ni se audita nada",
        async (_causa, como, error) => {
          const p = await preparar({ enArca: false });
          if ("bloqueado" in como || "dadoDeBaja" in como) darDeAltaEnArca(p.produccion, p.e, como);
          expect(await p.pasar()).toEqual({ ok: false, error });
          await sinCambios(p.e, p.inicial);
        },
      );

      it("ARCA caída: servicio no disponible; y cuando vuelve, el mismo pedido pasa", async () => {
        const p = await preparar();
        p.produccion.puntosDeVentaCaido = true;
        expect(await p.pasar()).toMatchObject({
          ok: false,
          error: { codigo: "SERVICIO_NO_DISPONIBLE" },
        });
        await sinCambios(p.e, p.inicial);
        p.produccion.puntosDeVentaCaido = false;
        expect(await p.pasar()).toEqual({ ok: true, valor: { yaEstaba: false } });
      });

      it("ARCA que no contesta: el tiempo límite propio corta, servicio no disponible, sin cambios", async () => {
        const p = await preparar();
        p.produccion.colgada = true;
        const inicio = Date.now();
        expect(await p.pasar()).toMatchObject({
          ok: false,
          error: { codigo: "SERVICIO_NO_DISPONIBLE" },
        });
        expect(Date.now() - inicio).toBeLessThan(10_000);
        await sinCambios(p.e, p.inicial);
      });

      it("sin certificado de producción cargado: SIN_CERTIFICADO_VIGENTE y ni se le pregunta a ARCA", async () => {
        const p = await preparar({ sinCertificadoDeProduccion: true });
        expect(await p.pasar()).toEqual({ ok: false, error: "SIN_CERTIFICADO_VIGENTE" });
        expect(p.produccion.consultasDePuntosDeVenta).toEqual([]);
        await sinCambios(p.e, p.inicial);
      });

      it("repetir lo ya aplicado es «ya estaba»: sin volver a llamar a ARCA (ni aunque esté caída), sin escribir ni auditar de nuevo", async () => {
        const p = await preparar();
        expect(await p.pasar()).toEqual({ ok: true, valor: { yaEstaba: false } });
        const despues = await estadoDelPunto(p.e);
        p.produccion.puntosDeVentaCaido = true;
        for (const version of [p.inicial?.version ?? 0, 0]) {
          expect(await p.pasar(version)).toEqual({ ok: true, valor: { yaEstaba: true } });
        }
        expect(p.produccion.consultasDePuntosDeVenta).toHaveLength(1);
        expect(await estadoDelPunto(p.e)).toEqual(despues);
        expect(await cambiosDeAmbiente(p.e)).toBe(1);
      });
    });

    // ===============================================================================================
    describe("lo que cambia mientras se espera a ARCA", () => {
      it("el punto de venta se edita (su versión sube): VERSION_DESACTUALIZADA, no se pasa un número que no se verificó", async () => {
        const p = await preparar();
        p.produccion.mientras = async () => {
          await dueno.query("update punto_de_venta set numero = 77 where id = $1", [p.e.pv]);
        };
        expect(await p.pasar()).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
        expect(await estadoDelPunto(p.e)).toMatchObject({ ambiente: "HOMOLOGACION", numero: 77 });
        expect(await cambiosDeAmbiente(p.e)).toBe(0);
      });

      it("el certificado de producción deja de estar vigente (se reemplaza): SIN_CERTIFICADO_VIGENTE, sin cambios", async () => {
        const p = await preparar();
        p.produccion.mientras = async () => {
          await dueno.query(
            `update certificado_arca set estado = 'REEMPLAZADO'
            where empresa_id = $1 and emisor_id = $2 and ambiente = 'PRODUCCION'`,
            [p.e.empresa, p.e.emisor],
          );
        };
        expect(await p.pasar()).toEqual({ ok: false, error: "SIN_CERTIFICADO_VIGENTE" });
        await sinCambios(p.e, p.inicial);
      });

      it("dos, tres o cuatro pasajes a la vez, todos ya verificados con ARCA antes de que alguno escriba: uno cambia, los demás «ya estaba», una sola auditoría", async () => {
        for (const n of [2, 4]) {
          const p = await preparar();
          const llegaron = crearBarrera(n);
          p.produccion.mientras = llegaron;
          const salidas = await Promise.all(Array.from({ length: n }, () => p.pasar()));
          // Un perdedor que se queda sin reintentos serializables no es un defecto (máquina cargada), pero no cuenta como éxito.
          const exitos = salidas.flatMap((r) => (r.ok ? [r.valor.yaEstaba] : []));
          const agotados = salidas.filter(
            (r) => !r.ok && typeof r.error === "object" && "tipo" in r.error,
          );
          expect(exitos.filter((ya) => !ya)).toHaveLength(1);
          expect(exitos.length + agotados.length).toBe(n);
          expect(p.produccion.consultasDePuntosDeVenta).toHaveLength(n);
          expect(await estadoDelPunto(p.e)).toMatchObject({ ambiente: "PRODUCCION" });
          expect(await cambiosDeAmbiente(p.e)).toBe(1);
        }
      });
    });

    // ===============================================================================================
    // SUPUESTO del ingeniero: D-79 y D-80 hablan de mudar y de activar un punto de venta, no de cambiar el ambiente; se aplica el mismo
    // criterio (la sucursal se lee con `FOR SHARE` y tiene que estar abierta). El cierre es el de la base (disparadores de 0005).
    describe("la sucursal del punto de venta contra su cierre", () => {
      async function enUnaSucursalNueva() {
        const p = await preparar();
        const norte = (
          await filas<{ id: string }>(
            "insert into sucursal (empresa_id, nombre) values ($1, 'Norte') returning id",
            [p.e.empresa],
          )
        )[0]?.id as string;
        await dueno.query("update punto_de_venta set sucursal_id = $2 where id = $1", [
          p.e.pv,
          norte,
        ]);
        const inicial = await estadoDelPunto(p.e);
        return { ...p, norte, inicial, pasar: () => p.pasar(inicial?.version ?? 0) };
      }
      const estaActiva = async (sucursal: string) =>
        (
          await filas<{ activa: boolean }>("select activa from sucursal where id = $1", [sucursal])
        )[0]?.activa;

      it("la sucursal ya cerrada: SUCURSAL_CERRADA y nada cambia", async () => {
        const p = await enUnaSucursalNueva();
        await dueno.query("update sucursal set activa = false where id = $1", [p.norte]);
        expect(await p.pasar()).toEqual({ ok: false, error: "SUCURSAL_CERRADA" });
        await sinCambios(p.e, p.inicial);
      });

      it("el cierre primero: el pasaje ESPERA (lo confirma pg_stat_activity) y, cuando el cierre confirma, repite, ve la sucursal cerrada y no escribe nada", async () => {
        const p = await enUnaSucursalNueva();
        const cierre = await unaConexion();
        try {
          await cierre.query("begin");
          await cierre.query("update sucursal set activa = false where id = $1", [p.norte]);
          const pasaje = p.pasar();
          const estado = terminado(pasaje);
          await esperar(
            () => esperandoBloqueo('from "sucursal" .* for share'),
            "el pasaje espera a la sucursal que se está cerrando",
          );
          expect(estado.listo).toBe(false);
          await cierre.query("commit");
          expect(await pasaje).toEqual({ ok: false, error: "SUCURSAL_CERRADA" });
          await sinCambios(p.e, p.inicial);
        } finally {
          await cierre.query("rollback").catch(() => undefined);
          await cierre.end();
        }
      });

      it("el pasaje primero: el cierre ESPERA, el pasaje sale bien, y recién entonces la sucursal queda cerrada", async () => {
        const p = await enUnaSucursalNueva();
        const cierre = await unaConexion();
        let tomada: () => void = () => undefined;
        const yaLaTomo = new Promise<void>((resolver) => (tomada = resolver));
        let soltar: () => void = () => undefined;
        const compuerta = new Promise<void>((resolver) => (soltar = resolver));
        // El pasaje lee la sucursal (con su bloqueo) y se queda ahí, DENTRO de su transacción, hasta que la prueba lo suelte.
        trasLeerLaSucursal = async () => {
          tomada();
          await compuerta;
        };
        try {
          const pasaje = p.pasar();
          const estadoPasaje = terminado(pasaje);
          await yaLaTomo;
          await cierre.query("begin");
          const cerrando = cierre.query("update sucursal set activa = false where id = $1", [
            p.norte,
          ]);
          const estadoCierre = terminado(cerrando);
          await esperar(
            () => esperandoBloqueo("update sucursal"),
            "el cierre espera al pasaje que tiene la sucursal",
          );
          expect(estadoPasaje.listo).toBe(false);
          expect(estadoCierre.listo).toBe(false);
          soltar();
          expect(await pasaje).toEqual({ ok: true, valor: { yaEstaba: false } });
          await cerrando;
          await cierre.query("commit");
          expect(await estadoDelPunto(p.e)).toMatchObject({ ambiente: "PRODUCCION" });
          expect(await cambiosDeAmbiente(p.e)).toBe(1);
          expect(await estaActiva(p.norte)).toBe(false);
        } finally {
          soltar();
          trasLeerLaSucursal = null;
          await cierre.query("rollback").catch(() => undefined);
          await cierre.end();
        }
      });

      it("el cierre que se deshace: el pasaje que esperaba sigue y pasa", async () => {
        const p = await enUnaSucursalNueva();
        const cierre = await unaConexion();
        try {
          await cierre.query("begin");
          await cierre.query("update sucursal set activa = false where id = $1", [p.norte]);
          const pasaje = p.pasar();
          await esperar(
            () => esperandoBloqueo('from "sucursal" .* for share'),
            "el pasaje espera a la sucursal",
          );
          await cierre.query("rollback");
          expect(await pasaje).toEqual({ ok: true, valor: { yaEstaba: false } });
          expect(await estaActiva(p.norte)).toBe(true);
          expect(await cambiosDeAmbiente(p.e)).toBe(1);
        } finally {
          await cierre.query("rollback").catch(() => undefined);
          await cierre.end();
        }
      });
    });

    it("sin permiso o desde otra empresa se rechaza antes de llamar a ARCA: el operador da SIN_PERMISO y el gerente ajeno no ve el punto de venta", async () => {
      const p = await preparar();
      const reloj = new RelojDePrueba(new Date());
      const casos = casosDeFacturacion(
        entorno,
        { HOMOLOGACION: new EmisionFalsa(), PRODUCCION: p.produccion },
        reloj,
      );
      const pedido = {
        puntoDeVentaId: puntoDeVentaId(p.e.pv),
        ambiente: "PRODUCCION",
        versionEsperada: p.inicial?.version ?? 0,
      } as const;
      const operadorAjeno = await crearEscenarioDeCasos(dueno, propia.base, { rol: "OPERADOR" });
      expect(
        await casos.cambiarAmbienteDePuntoDeVenta(operadorAjeno.como(reloj.ahora()), pedido),
      ).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      const gerenteAjeno = await crearEscenarioDeCasos(dueno, propia.base, { rol: "GERENTE" });
      expect(
        await casos.cambiarAmbienteDePuntoDeVenta(gerenteAjeno.como(reloj.ahora()), pedido),
      ).toEqual({
        ok: false,
        error: "PUNTO_DE_VENTA_NO_ENCONTRADO",
      });
      expect(p.produccion.consultasDePuntosDeVenta).toEqual([]);
      await sinCambios(p.e, p.inicial);
    });
  },
);
