import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { huellaDeControles } from "../../src/modulos/cierre/publico";
import { crearBarrera, crearBaseAparte, crearEntornoDePrueba, type TxDePrueba } from "./entorno";
import {
  FECHA,
  aporteDeActividad,
  aporteFalso,
  armarCierre,
  control,
  crearJornada,
  crearMundoDeCierre,
  prepararTablaDeActividad,
  registrarActividad,
  registrarCorreccion,
  type Mundo,
} from "./cierre-apoyo";

/**
 * Concurrencia REAL del cierre del día (E3b §3.7 y §5): cada prueba lanza varias transacciones a la vez (`Promise.all`) y, con una barrera
 * dentro de la transacción (tras leer la autorización, ANTES de tomar la jornada), fuerza que todas hayan empezado antes de que cualquiera
 * escriba. Después mira la base: nunca un estado inválido, nunca un cierre doble, y el perdedor (tras el reintento serializable del
 * adaptador) ve el resultado del ganador. La actividad de la sucursal (caja, correcciones) se simula con una tabla de prueba.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 10;

type Fila = Record<string, unknown>;
type Gancho = (tx: TxDePrueba, esperar: () => Promise<void>) => TxDePrueba;

describe.skipIf(base === null)("cierre del día: concurrencia", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let barrera: () => Promise<void> = () => Promise.resolve();
  let gancho: Gancho = (tx) => tx;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 12, (tx) => gancho(tx, () => barrera()));
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    await prepararTablaDeActividad(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  /** Prepara la ronda: `participantes` transacciones esperan tras su primera lectura de la autorización. */
  const ronda = (participantes: number) => {
    barrera = crearBarrera(participantes);
    gancho = (tx, esperar) => {
      let primera = true;
      const original = tx.autorizacion;
      return {
        ...tx,
        autorizacion: {
          ...original,
          delActor: async (contexto) => {
            const r = await original.delActor(contexto);
            if (primera) {
              primera = false;
              await esperar();
            }
            return r;
          },
        },
      };
    };
  };

  /**
   * Quien tiene actividad hace menos pasos antes de tomar la jornada que quien cierra el día, así que sin ayuda gana siempre. En las rondas
   * impares espera un poco después de la barrera para que gane el cierre: así se ejercitan los DOS órdenes de la carrera.
   */
  const demoraDeLaActividad = async (ronda: number) => {
    if (ronda % 2 === 1) await new Promise((resolver) => setTimeout(resolver, 250));
  };

  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.n);
  const estadoDe = async (m: Mundo) =>
    (
      await filas<{ estado: string }>(
        "select estado from jornada_de_sucursal where empresa_id = $1 and fecha_negocio = $2",
        [m.empresa, FECHA],
      )
    )[0]?.estado;
  const auditorias = (m: Mundo, accion: string) =>
    contar("select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2", [
      m.empresa,
      accion,
    ]);
  const fotos = (m: Mundo) =>
    contar("select count(*) as n from control_de_jornada_cerrada where empresa_id = $1", [
      m.empresa,
    ]);

  const entradaDe = (m: Mundo) => ({ sucursalId: m.sucursal, fechaDeNegocio: FECHA });

  it("dos «Cerrar el día» a la vez con el mismo pedido: un solo cierre, una sola foto, una sola auditoría; el otro ve yaEstabaCerrada", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const aporte = aporteFalso("facturacion", [
        control("facturacion.reconocible", "RECONOCIBLE", 2),
        control("facturacion.informa", "INFORMA", 1),
      ]);
      const m = await crearMundoDeCierre(entorno, dueno);
      await crearJornada(dueno, m);
      const { casos } = armarCierre(entorno, [aporte]);
      expect((await casos.iniciarAuditoria(m.ctx(), entradaDe(m))).ok).toBe(true);
      const pedido = {
        ...entradaDe(m),
        huellaVista: huellaDeControles(aporte.controlesActuales),
        reconocimientos: [{ modulo: "facturacion", clave: "facturacion.reconocible", texto: null }],
        observacion: null,
      };
      ronda(2);
      const [a, b] = await Promise.all([
        casos.cerrarJornada(m.ctx(), pedido),
        casos.cerrarJornada(m.ctx(), pedido),
      ]);
      expect(a.ok && b.ok, `ronda ${i}`).toBe(true);
      const yaEstaba = [a, b].map((r) => (r.ok ? r.valor.yaEstabaCerrada : null));
      expect(
        yaEstaba.filter((v) => v === false),
        `ronda ${i}`,
      ).toHaveLength(1);
      expect(
        yaEstaba.filter((v) => v === true),
        `ronda ${i}`,
      ).toHaveLength(1);
      expect(await estadoDe(m)).toBe("CERRADA");
      expect(await fotos(m)).toBe(2);
      expect(await auditorias(m, "JORNADA_CERRADA")).toBe(1);
      expect(aporte.congelaciones).toHaveLength(1);
    }
  });

  it("dos cierres a la vez con reconocimientos distintos: uno cierra y el otro recibe JORNADA_CERRADA (nunca dos cierres)", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const aporte = aporteFalso("facturacion", [
        control("facturacion.reconocible", "RECONOCIBLE", 2),
      ]);
      const m = await crearMundoDeCierre(entorno, dueno);
      await crearJornada(dueno, m);
      const { casos } = armarCierre(entorno, [aporte]);
      await casos.iniciarAuditoria(m.ctx(), entradaDe(m));
      const huellaVista = huellaDeControles(aporte.controlesActuales);
      const pedido = (texto: string) => ({
        ...entradaDe(m),
        huellaVista,
        reconocimientos: [{ modulo: "facturacion", clave: "facturacion.reconocible", texto }],
        observacion: null,
      });
      ronda(2);
      const resultados = await Promise.all([
        casos.cerrarJornada(m.ctx(), pedido("Primero")),
        casos.cerrarJornada(m.ctx(), pedido("Segundo")),
      ]);
      expect(
        resultados.filter((r) => r.ok),
        `ronda ${i}`,
      ).toHaveLength(1);
      expect(
        resultados.filter((r) => !r.ok).map((r) => (r.ok ? null : r.error)),
        `ronda ${i}`,
      ).toEqual(["JORNADA_CERRADA"]);
      expect(await auditorias(m, "JORNADA_CERRADA")).toBe(1);
      expect(await fotos(m)).toBe(1);
      expect(aporte.congelaciones).toHaveLength(1);
      // El texto guardado es el del que ganó.
      const guardado = (
        await filas<{ texto: string }>(
          "select texto from control_de_jornada_cerrada where empresa_id = $1",
          [m.empresa],
        )
      )[0]?.texto;
      expect(["Primero", "Segundo"]).toContain(guardado);
    }
  });

  it("tres «Empezar el cierre» a la vez: una sola auditoría y un solo cambio de estado", async () => {
    for (let i = 0; i < RONDAS; i++) {
      const m = await crearMundoDeCierre(entorno, dueno);
      await crearJornada(dueno, m);
      const { casos } = armarCierre(entorno, []);
      ronda(3);
      const resultados = await Promise.all([
        casos.iniciarAuditoria(m.ctx(), entradaDe(m)),
        casos.iniciarAuditoria(m.ctx(), entradaDe(m)),
        casos.iniciarAuditoria(m.ctx(), entradaDe(m)),
      ]);
      expect(
        resultados.every((r) => r.ok),
        `ronda ${i}`,
      ).toBe(true);
      const nuevos = resultados.filter((r) => r.ok && !r.valor.yaEstabaEnAuditoria);
      expect(nuevos, `ronda ${i}`).toHaveLength(1);
      expect(await estadoDe(m)).toBe("EN_AUDITORIA");
      expect(await auditorias(m, "JORNADA_EN_AUDITORIA")).toBe(1);
      const version = (
        await filas<{ version: number }>(
          "select version from jornada_de_sucursal where empresa_id = $1",
          [m.empresa],
        )
      )[0]?.version;
      expect(version).toBe(2);
    }
  });

  it("cancelar y cerrar a la vez: o cierra (y cancelar ve JORNADA_CERRADA) o se cancela primero (y cerrar ve JORNADA_NO_EN_AUDITORIA); el estado y las auditorías cuadran", async () => {
    const vistos = new Set<string>();
    for (let i = 0; i < RONDAS * 2; i++) {
      const m = await crearMundoDeCierre(entorno, dueno);
      await crearJornada(dueno, m);
      const { casos } = armarCierre(entorno, []);
      await casos.iniciarAuditoria(m.ctx(), entradaDe(m));
      ronda(2);
      const [cancelar, cerrar] = await Promise.all([
        casos.cancelarAuditoria(m.ctx(), entradaDe(m)),
        casos.cerrarJornada(m.ctx(), {
          ...entradaDe(m),
          huellaVista: huellaDeControles([]),
          reconocimientos: [],
          observacion: null,
        }),
      ]);
      const estado = await estadoDe(m);
      if (estado === "CERRADA") {
        expect(cerrar.ok, `ronda ${i}`).toBe(true);
        expect(cancelar, `ronda ${i}`).toEqual({ ok: false, error: "JORNADA_CERRADA" });
        expect(await auditorias(m, "JORNADA_AUDITORIA_CANCELADA")).toBe(0);
        expect(await auditorias(m, "JORNADA_CERRADA")).toBe(1);
      } else {
        expect(estado, `ronda ${i}`).toBe("ABIERTA");
        expect(cancelar.ok, `ronda ${i}`).toBe(true);
        expect(cerrar, `ronda ${i}`).toEqual({ ok: false, error: "JORNADA_NO_EN_AUDITORIA" });
        expect(await auditorias(m, "JORNADA_AUDITORIA_CANCELADA")).toBe(1);
        expect(await auditorias(m, "JORNADA_CERRADA")).toBe(0);
      }
      vistos.add(estado ?? "?");
    }
    expect(vistos.size).toBeGreaterThan(0);
  });

  it("abrir actividad contra empezar el cierre (misma sucursal y fecha): o hay actividad y se ve como impedimento, o gana el cierre y la actividad se rechaza; nunca una jornada en auditoría con actividad abierta", async () => {
    const resultados = new Set<string>();
    for (let i = 0; i < RONDAS * 2; i++) {
      const m = await crearMundoDeCierre(entorno, dueno);
      await crearJornada(dueno, m);
      const { casos } = armarCierre(entorno, [aporteDeActividad("facturacion")]);
      ronda(2);
      const [inicio, actividad] = await Promise.all([
        casos.iniciarAuditoria(m.ctx(), entradaDe(m)),
        entorno.ejecutar({ contexto: m.ctx() }, async (tx) => {
          await tx.autorizacion.delActor(m.ctx()); // la barrera: las dos empiezan antes de que cualquiera escriba
          await demoraDeLaActividad(i);
          return registrarActividad(tx, m);
        }),
      ]);
      const abiertas = await contar(
        "select count(*) as n from prueba_actividad where empresa_id = $1 and tipo = 'sesion' and abierta",
        [m.empresa],
      );
      const estado = await estadoDe(m);
      if (inicio.ok) {
        // Ganó el cierre: no puede haber actividad registrada, y quien la intentó recibió el rechazo.
        expect(estado, `ronda ${i}`).toBe("EN_AUDITORIA");
        expect(abiertas, `ronda ${i}`).toBe(0);
        expect(actividad, `ronda ${i}`).toEqual({ ok: false, error: "JORNADA_EN_AUDITORIA" });
        resultados.add("gana el cierre");
      } else {
        // Ganó la actividad: el cierre la ve como impedimento y la jornada sigue abierta.
        expect(inicio, `ronda ${i}`).toMatchObject({
          ok: false,
          error: { codigo: "JORNADA_CON_IMPEDIMENTOS" },
        });
        expect(actividad.ok, `ronda ${i}`).toBe(true);
        expect(estado, `ronda ${i}`).toBe("ABIERTA");
        expect(abiertas, `ronda ${i}`).toBe(1);
        resultados.add("gana la actividad");
      }
      // El invariante de siempre: nunca en auditoría con una sesión abierta.
      expect(estado === "EN_AUDITORIA" && abiertas > 0, `ronda ${i}`).toBe(false);
    }
    // Los dos órdenes de la carrera se ejercitaron.
    expect([...resultados].sort()).toEqual(["gana el cierre", "gana la actividad"]);
  });

  it("corregir contra cerrar la jornada: la foto guardada coincide con lo corregido; las correcciones fuera de auditoría se rechazan sin escribir", async () => {
    const vistos = new Set<string>();
    for (let i = 0; i < RONDAS * 2; i++) {
      const m = await crearMundoDeCierre(entorno, dueno);
      await crearJornada(dueno, m);
      const { casos, consultas } = armarCierre(entorno, [aporteDeActividad("facturacion")]);
      await casos.iniciarAuditoria(m.ctx(), entradaDe(m));
      const vista = await consultas.controlesDeLaJornada(m.ctx(), entradaDe(m));
      expect(vista.ok).toBe(true);
      const huellaVista = vista.ok ? vista.valor.huella : "";
      ronda(3);
      const corregir = () =>
        entorno.ejecutar({ contexto: m.ctx() }, async (tx) => {
          await tx.autorizacion.delActor(m.ctx());
          await demoraDeLaActividad(i);
          return registrarCorreccion(tx, m);
        });
      const [cierre, c1, c2] = await Promise.all([
        casos.cerrarJornada(m.ctx(), {
          ...entradaDe(m),
          huellaVista,
          reconocimientos: [],
          observacion: null,
        }),
        corregir(),
        corregir(),
      ]);
      const corregidas = await contar(
        "select count(*) as n from prueba_actividad where empresa_id = $1 and tipo = 'correccion'",
        [m.empresa],
      );
      expect(corregidas, `ronda ${i}`).toBe([c1, c2].filter((c) => c.ok).length);
      for (const c of [c1, c2]) {
        if (!c.ok)
          expect(["JORNADA_CERRADA", "JORNADA_NO_EN_AUDITORIA"], `ronda ${i}`).toContain(c.error);
      }
      if (cierre.ok) {
        // Cerró: cada corrección confirmada está en la foto (Σ guardada = Σ recalculada), y las demás se rechazaron.
        expect(await estadoDe(m)).toBe("CERRADA");
        const guardada = (
          await filas<{ cantidad: number }>(
            "select cantidad from control_de_jornada_cerrada where empresa_id = $1 and clave = 'facturacion.correcciones'",
            [m.empresa],
          )
        )[0]?.cantidad;
        expect(guardada, `ronda ${i}`).toBe(corregidas);
        for (const c of [c1, c2]) if (!c.ok) expect(c.error, `ronda ${i}`).toBe("JORNADA_CERRADA");
        vistos.add("cerró");
      } else {
        // Una corrección entró antes: la huella que se vio ya no es la de ahora y no se cerró con algo que nadie vio.
        expect(cierre, `ronda ${i}`).toMatchObject({
          ok: false,
          error: { codigo: "CONTROLES_CAMBIARON" },
        });
        expect(await estadoDe(m)).toBe("EN_AUDITORIA");
        expect(await fotos(m)).toBe(0);
        vistos.add("controles cambiaron");
      }
    }
    // Los dos órdenes de la carrera se ejercitaron: cierra (y las correcciones tardías se rechazan) o se corrige primero.
    expect([...vistos].sort()).toEqual(["cerró", "controles cambiaron"]);
  });

  it("una operación que termina bien deja todo o nada: un cierre con un aporte que falla en una carrera no deja la foto ni el estado a medias", async () => {
    for (let i = 0; i < 4; i++) {
      const aporte = aporteFalso("facturacion");
      aporte.falla = "AL_CONGELAR";
      const m = await crearMundoDeCierre(entorno, dueno);
      await crearJornada(dueno, m);
      const { casos } = armarCierre(entorno, [aporte]);
      await casos.iniciarAuditoria(m.ctx(), entradaDe(m));
      ronda(2);
      const pedido = {
        ...entradaDe(m),
        huellaVista: huellaDeControles([]),
        reconocimientos: [],
        observacion: null,
      };
      const resultados = await Promise.all([
        casos.cerrarJornada(m.ctx(), pedido),
        casos.cerrarJornada(m.ctx(), pedido),
      ]);
      for (const r of resultados) {
        expect(r).toEqual({
          ok: false,
          error: { codigo: "APORTE_NO_DISPONIBLE", modulo: "facturacion" },
        });
      }
      expect(await estadoDe(m)).toBe("EN_AUDITORIA");
      expect(await fotos(m)).toBe(0);
      expect(await auditorias(m, "JORNADA_CERRADA")).toBe(0);
    }
  });
});
