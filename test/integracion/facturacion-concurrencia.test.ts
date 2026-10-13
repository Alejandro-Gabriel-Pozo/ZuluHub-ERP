import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import { comoEmpresa, crearBarrera } from "./entorno";
import { acepta, check, clave } from "./fiscal-apoyo";
import {
  asegurarSerie,
  cerrarSerie,
  crearComprobante,
  crearEscenario,
  datosDeComprobante,
  entrarEnValidacion,
  huellaAlAzar,
  insertarComprobante,
  leerSerie,
  marcarAutorizado,
  marcarEstado,
  reservarSerie,
  serieDe,
  viaDuenoDirecto,
  viaSesion,
  volverAPendiente,
  RENGLON_DE_121,
  DESGLOSE_DE_121,
  type Ejecutor,
  type Escenario,
} from "./facturacion-apoyo";
import { SesionDePrueba, esperarBloqueo, type Intento } from "./sesiones";

/**
 * Facturación F2: la concurrencia contra una base real. Dos acciones simultáneas, con barrera y `Promise.all`:
 *  1. Idempotencia: la misma operación repetida (a la vez) no duplica el comprobante.
 *  2. Numeración: muchos comprobantes de una misma serie, con autorizaciones, rechazos, inciertos y números que
 *     no salieron, en paralelo: los números autorizados son exactamente 1..n, sin repetidos ni huecos.
 *  3. Reservas simultáneas, descartar contra validar, cambio de ambiente contra alta, dos cargas de certificado
 *     y dos resincronizaciones.
 * Cada transacción es la de un trabajo real: abre su sesión con el rol de la aplicación y el contexto de la
 * empresa SIN persona (el trabajo de sistema), hace su paso y confirma; las restricciones diferidas saltan al
 * confirmar, bajo RLS forzada.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const AISLAMIENTOS = ["read committed", "serializable"] as const;
type Aislamiento = (typeof AISLAMIENTOS)[number];

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Generador pseudoaleatorio con semilla (mulberry32): una falla se reproduce con la misma semilla. */
function azar(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe.skipIf(base === null)("facturación: concurrencia", () => {
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
  });

  /** Abre la sesión de un trabajo de sistema (sin persona) o de una persona. */
  const abrir = (x: Escenario, aislamiento: Aislamiento = "read committed", persona: string | null = null) =>
    SesionDePrueba.abrir(
      base!,
      "zuluhub_app",
      comoEmpresa(empresaId(x.empresa), persona === null ? null : personaId(persona)),
      aislamiento,
    );

  /**
   * Una transacción con reintento ante un fallo de serialización o un interbloqueo (lo que hace el adaptador real):
   * el cuerpo se repite entero. Devuelve lo que devolvió el cuerpo.
   */
  async function transaccion<T>(
    x: Escenario,
    aislamiento: Aislamiento,
    cuerpo: (ej: Ejecutor) => Promise<T>,
    persona: string | null = null,
  ): Promise<T> {
    for (let intento = 1; ; intento++) {
      const s = await abrir(x, aislamiento, persona);
      try {
        const resultado = await cuerpo(viaSesion(s));
        const confirmado = await s.confirmar();
        if (confirmado.ok) return resultado;
        if (!reintentable(confirmado) || intento >= 100) {
          throw new Error(`no confirmó: ${confirmado.codigo} ${confirmado.restriccion ?? ""} ${confirmado.mensaje}`);
        }
      } catch (error) {
        const e = error as { reintentar?: boolean };
        if (e.reintentar !== true || intento >= 100) throw error;
      } finally {
        await s.cerrar();
      }
      await dormir(5 + Math.floor(Math.random() * 15));
    }
  }
  const reintentable = (r: Intento) => !r.ok && (r.codigo === "40001" || r.codigo === "40P01");
  /** Un paso que falló por serialización o interbloqueo se repite; cualquier otro fallo es un defecto. */
  const o = (r: Intento): Extract<Intento, { ok: true }> => {
    if (!r.ok) {
      if (reintentable(r)) throw Object.assign(new Error(r.mensaje), { reintentar: true });
      throw new Error(`falló un paso: ${r.codigo} ${r.restriccion ?? ""} ${r.mensaje}`);
    }
    return r;
  };

  // ===============================================================================================
  // 1. Idempotencia
  // ===============================================================================================
  describe("la misma operación repetida a la vez no duplica el comprobante", () => {
    it.each(AISLAMIENTOS)(
      "ocho pedidos simultáneos con la misma clave de pantalla (INSERT ... ON CONFLICT DO NOTHING) dejan un comprobante, un renglón y un desglose, y todos terminan bien [%s]",
      async (aislamiento) => {
        const x = await crearEscenario(dueno);
        const clavePantalla = randomUUID();
        const barrera = crearBarrera(8);
        const resultados = await Promise.all(
          Array.from({ length: 8 }, async () =>
            transaccion(
              x,
              aislamiento,
              async (ej) => {
                await barrera().catch(() => undefined);
                const datos = datosDeComprobante(x, { origen_id: clavePantalla, creado_por: x.persona });
                const columnas = Object.keys(datos);
                const r = o(
                  await ej(
                    `insert into comprobante (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")})
                     on conflict (empresa_id, origen_id) where origen_tipo = 'MANUAL' do nothing returning id`,
                    columnas.map((c) => datos[c]),
                  ),
                );
                if (r.filas === 0) return { yaExistia: true };
                // El ganador completa su contenido (los demás devolverían el comprobante existente).
                o(await insertarHijos(ej, x, datos["id"] as string));
                return { yaExistia: false };
              },
              x.persona,
            ),
          ),
        );
        expect(resultados.filter((r) => !r.yaExistia)).toHaveLength(1);
        expect(resultados.filter((r) => r.yaExistia)).toHaveLength(7);
        const cuenta = await dueno.query(
          `select (select count(*)::int from comprobante where empresa_id = $1) as comprobantes,
                  (select count(*)::int from comprobante_linea where empresa_id = $1) as renglones,
                  (select count(*)::int from comprobante_alicuota where empresa_id = $1) as desgloses`,
          [x.empresa],
        );
        expect(cuenta.rows[0]).toEqual({ comprobantes: 1, renglones: 1, desgloses: 1 });
      },
    );

    it.each(AISLAMIENTOS)(
      "dos altas que chocan sin ON CONFLICT: una gana y la otra recibe la violación de la única (23505), nunca dos comprobantes [%s]",
      async (aislamiento) => {
        for (let ronda = 0; ronda < 5; ronda++) {
          const x = await crearEscenario(dueno);
          const clavePantalla = randomUUID();
          const barrera = crearBarrera(2);
          const intentos = await Promise.all(
            [0, 1].map(async () => {
              const s = await abrir(x, aislamiento, x.persona);
              try {
                await barrera();
                const r = await insertarComprobante(viaSesion(s), datosDeComprobante(x, { origen_id: clavePantalla }));
                if (!r.ok) return r;
                return await s.confirmar();
              } finally {
                await s.cerrar();
              }
            }),
          );
          expect(intentos.filter((r) => r.ok)).toHaveLength(1);
          const perdedor = intentos.find((r) => !r.ok);
          expect(perdedor).toBeDefined();
          if (perdedor !== undefined && !perdedor.ok) {
            // Con READ COMMITTED espera a la ganadora y viola la única; con SERIALIZABLE puede abortar antes (40001).
            expect(["23505", "40001"], perdedor.mensaje).toContain(perdedor.codigo);
            if (perdedor.codigo === "23505") {
              expect(["comprobante_manual_uk", "comprobante_identidad_uk"]).toContain(perdedor.restriccion);
            }
          }
          const { rows } = await dueno.query("select count(*)::int as n from comprobante where empresa_id = $1", [x.empresa]);
          expect(rows[0]).toEqual({ n: 1 });
        }
      },
    );
  });

  /** Los hijos (un renglón y su desglose) del comprobante de 121,00. */
  const insertarHijos = async (ej: Ejecutor, x: Escenario, id: string): Promise<Intento> => {
    const linea = await ej(
      `insert into comprobante_linea (empresa_id, comprobante_id, posicion, descripcion, cantidad, precio_unitario, alicuota, importe)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [x.empresa, id, RENGLON_DE_121.posicion, RENGLON_DE_121.descripcion, RENGLON_DE_121.cantidad, RENGLON_DE_121.precio_unitario, RENGLON_DE_121.alicuota, RENGLON_DE_121.importe],
    );
    if (!linea.ok) return linea;
    return ej(
      `insert into comprobante_alicuota (empresa_id, comprobante_id, alicuota, total, neto, iva) values ($1, $2, $3, $4, $5, $6)`,
      [x.empresa, id, DESGLOSE_DE_121.alicuota, DESGLOSE_DE_121.total, DESGLOSE_DE_121.neto, DESGLOSE_DE_121.iva],
    );
  };

  // ===============================================================================================
  // 2. Numeración sin duplicados ni huecos
  // ===============================================================================================
  describe("numeración: sin duplicados ni huecos con trabajadores en paralelo", () => {
    /**
     * `trabajadores` trabajadores se reparten `comprobantes` comprobantes PENDIENTE de una misma serie. Cada uno
     * hace lo que hace el trabajo de validación: reservar la serie (si está ocupada, espera), pasar a validación,
     * y terminar al azar en AUTORIZADO, RECHAZADO, NO_ENVIADO (vuelve a PENDIENTE y se reintenta) o INCIERTO
     * (la reconciliación lo resuelve: lo autoriza o, si ARCA no lo tiene, lo libera y se reintenta).
     */
    async function correr(aislamiento: Aislamiento, trabajadores: number, comprobantes: number, semilla: number) {
      const x = await crearEscenario(dueno);
      const serie = serieDe(x);
      const ids: string[] = [];
      for (let i = 0; i < comprobantes; i++) ids.push(await crearComprobante(dueno, x));
      const barrera = crearBarrera(trabajadores);
      let autorizadosPorRespuesta = 0;
      let reconciliados = 0;
      let rechazados = 0;
      let noEnviados = 0;
      let liberadosPorConsulta = 0;

      async function trabajar(mios: string[], rnd: () => number): Promise<void> {
        await barrera();
        for (const id of mios) {
          // Hasta que el comprobante llegue a un estado terminal (AUTORIZADO o RECHAZADO).
          for (;;) {
            const reservado = await transaccion(x, aislamiento, async (ej) => {
              const estado = o(await ej("select estado from comprobante where id = $1", [id])).rows[0]?.["estado"];
              if (estado !== "PENDIENTE") return "TERMINADO";
              o(await asegurarSerie(ej, serie));
              const r = o(await reservarSerie(ej, serie, id));
              if (r.filas === 0) return "OCUPADA";
              o(await entrarEnValidacion(ej, id, r.rows[0]?.["numero"] as string));
              return "RESERVADO";
            });
            if (reservado === "TERMINADO") break;
            if (reservado === "OCUPADA") {
              await dormir(5 + Math.floor(rnd() * 15));
              continue;
            }
            // «Afuera»: ARCA responde (o no).
            await dormir(Math.floor(rnd() * 5));
            const suerte = rnd();
            if (suerte < 0.55) {
              await transaccion(x, aislamiento, async (ej) => {
                o(await marcarAutorizado(ej, id));
                o(await cerrarSerie(ej, serie, true));
              });
              autorizadosPorRespuesta++;
              break;
            } else if (suerte < 0.7) {
              await transaccion(x, aislamiento, async (ej) => {
                o(await marcarEstado(ej, id, "RECHAZADO"));
                o(await cerrarSerie(ej, serie, false));
              });
              rechazados++;
              break;
            } else if (suerte < 0.85) {
              // El pedido seguro no salió: se libera el número y se reintenta.
              await transaccion(x, aislamiento, async (ej) => {
                o(await volverAPendiente(ej, id));
                o(await cerrarSerie(ej, serie, false));
              });
              noEnviados++;
            } else {
              // Sin respuesta clara: INCIERTO, la serie sigue EN_CURSO; la reconciliación consulta a ARCA.
              await transaccion(x, aislamiento, async (ej) => o(await marcarEstado(ej, id, "INCIERTO")));
              await dormir(Math.floor(rnd() * 5));
              if (rnd() < 0.5) {
                await transaccion(x, aislamiento, async (ej) => {
                  o(await marcarAutorizado(ej, id, "RECONCILIACION"));
                  o(await cerrarSerie(ej, serie, true));
                });
                reconciliados++;
                break;
              }
              await transaccion(x, aislamiento, async (ej) => {
                o(await volverAPendiente(ej, id));
                o(await cerrarSerie(ej, serie, false));
              });
              liberadosPorConsulta++;
            }
          }
        }
      }

      const repartos: string[][] = Array.from({ length: trabajadores }, () => []);
      ids.forEach((id, i) => repartos[i % trabajadores]!.push(id));
      await Promise.all(repartos.map((mios, i) => trabajar(mios, azar(semilla + i))));

      // Todo comprobante llegó a un estado terminal; los números autorizados son exactamente 1..n.
      const estados = (
        await dueno.query<{ estado: string; n: number }>(
          "select estado, count(*)::int as n from comprobante where empresa_id = $1 group by estado",
          [x.empresa],
        )
      ).rows;
      const porEstado = Object.fromEntries(estados.map((f) => [f.estado, f.n]));
      expect(Object.keys(porEstado).sort(), JSON.stringify(porEstado)).toEqual(
        [...new Set(["AUTORIZADO", ...(rechazados > 0 ? ["RECHAZADO"] : [])])].sort(),
      );
      const autorizados = autorizadosPorRespuesta + reconciliados;
      expect(porEstado["AUTORIZADO"]).toBe(autorizados);
      expect((porEstado["AUTORIZADO"] ?? 0) + (porEstado["RECHAZADO"] ?? 0)).toBe(comprobantes);
      const numeros = (
        await dueno.query<{ numero: string }>(
          "select numero::text from comprobante where empresa_id = $1 and numero is not null",
          [x.empresa],
        )
      ).rows
        .map((f) => Number(f.numero))
        .sort((p, q) => p - q);
      expect(numeros, "los números autorizados son 1..n sin repetidos ni huecos").toEqual(
        Array.from({ length: autorizados }, (_, i) => i + 1),
      );
      expect(await leerSerie(dueno, serie)).toMatchObject({ estado: "LIBRE", ultimo: String(autorizados) });
      // Cada autorizado guarda el número que reservó, y todos pasaron por validación al menos una vez.
      const raros = await dueno.query(
        `select 1 from comprobante where empresa_id = $1 and estado = 'AUTORIZADO' and (numero <> numero_reservado or envios < 1)`,
        [x.empresa],
      );
      expect(raros.rowCount).toBe(0);
      return { autorizados, rechazados, noEnviados, liberadosPorConsulta, reconciliados };
    }

    it.each(AISLAMIENTOS)(
      "5 trabajadores × 4 comprobantes sobre la misma serie, con autorizaciones, rechazos, inciertos y números que no salieron: los autorizados son 1..n [%s]",
      async (aislamiento) => {
        const semilla = Number(process.env["FC_SEMILLA"] ?? 20261013);
        const r = await correr(aislamiento, 5, 20, semilla);
        expect(r.autorizados).toBeGreaterThan(0);
      },
    );

    it("dos rondas chicas y repetidas, con la serie empezando en un número alto: nunca un hueco ni un repetido", async () => {
      for (let ronda = 0; ronda < 2; ronda++) {
        await correr("read committed", 3, 9, 777 + ronda);
      }
    });
  });

  // ===============================================================================================
  // 3. Reservas simultáneas, descartar contra validar, ambiente, certificados, resincronización
  // ===============================================================================================
  describe("acciones simultáneas sobre lo mismo", () => {
    it("dos comprobantes reservan la misma serie a la vez: uno obtiene el número, el otro recibe la serie ocupada (0 filas); ninguno puede entrar a validación sin reserva", async () => {
      for (const aislamiento of AISLAMIENTOS) {
        const x = await crearEscenario(dueno);
        const serie = serieDe(x);
        const ids = [await crearComprobante(dueno, x), await crearComprobante(dueno, x)];
        // La serie ya existe: crearla adentro, antes de la barrera, haría esperar a una transacción por la otra.
        acepta(await asegurarSerie(viaDuenoDirecto(dueno), serie));
        const barrera = crearBarrera(2);
        const resultados = await Promise.all(
          ids.map((id) =>
            transaccion(x, aislamiento, async (ej) => {
              await barrera().catch(() => undefined);
              const r = o(await reservarSerie(ej, serie, id));
              if (r.filas === 0) return { id, numero: null };
              o(await entrarEnValidacion(ej, id, r.rows[0]?.["numero"] as string));
              return { id, numero: r.rows[0]?.["numero"] as string };
            }),
          ),
        );
        expect(resultados.filter((r) => r.numero === "1")).toHaveLength(1);
        expect(resultados.filter((r) => r.numero === null)).toHaveLength(1);
        const ganador = resultados.find((r) => r.numero !== null)!.id;
        expect(await leerSerie(dueno, serie)).toMatchObject({ estado: "EN_CURSO", solicitud: ganador, en_curso: "1" });
      }
    });

    it("dos comprobantes pasan a validación con el mismo número SIN reservar la serie, a la vez: ninguno confirma (comprobante_en_vuelo_uk o comprobante_sin_reserva)", async () => {
      const x = await crearEscenario(dueno);
      const serie = serieDe(x);
      acepta(await asegurarSerie(viaDuenoDirecto(dueno), serie));
      const ids = [await crearComprobante(dueno, x), await crearComprobante(dueno, x)];
      const barrera = crearBarrera(2);
      const resultados = await Promise.all(
        ids.map(async (id) => {
          const s = await abrir(x, "read committed");
          try {
            await barrera();
            const r = await entrarEnValidacion(viaSesion(s), id, "1");
            if (!r.ok) return r;
            return await s.confirmar();
          } finally {
            await s.cerrar();
          }
        }),
      );
      expect(resultados.every((r) => !r.ok)).toBe(true);
      for (const r of resultados) {
        if (!r.ok) expect(["comprobante_en_vuelo_uk", "comprobante_sin_reserva"], r.mensaje).toContain(r.restriccion);
      }
      for (const id of ids) {
        expect((await dueno.query("select estado from comprobante where id = $1", [id])).rows[0]).toEqual({ estado: "PENDIENTE" });
      }
    });

    it.each(AISLAMIENTOS)(
      "descartar contra validar el mismo comprobante (20 rondas): o queda DESCARTADO sin número o EN_VALIDACION con su reserva, nunca los dos [%s]",
      async (aislamiento) => {
        let descartados = 0;
        let validados = 0;
        let ambosAbortaron = 0;
        for (let ronda = 0; ronda < 20; ronda++) {
          const x = await crearEscenario(dueno);
          const serie = serieDe(x);
          const id = await crearComprobante(dueno, x);
          const barrera = crearBarrera(2);
          const [validar, descartar] = await Promise.all([
            (async () => {
              const s = await abrir(x, aislamiento);
              try {
                const pasos: Intento[] = [await asegurarSerie(viaSesion(s), serie)];
                await barrera();
                const r = await reservarSerie(viaSesion(s), serie, id);
                pasos.push(r);
                if (r.ok && r.filas === 1) pasos.push(await entrarEnValidacion(viaSesion(s), id, r.rows[0]?.["numero"] as string));
                const mal = pasos.find((p) => !p.ok);
                if (mal !== undefined) return mal;
                return await s.confirmar();
              } finally {
                await s.cerrar();
              }
            })(),
            (async () => {
              const s = await abrir(x, aislamiento, x.persona);
              try {
                await barrera();
                const r = await s.intentar(
                  "update comprobante set estado = 'DESCARTADO', motivo_descarte = 'lo descartó la persona' where id = $1",
                  [id],
                );
                if (!r.ok) return r;
                return await s.confirmar();
              } finally {
                await s.cerrar();
              }
            })(),
          ]);
          // Lo que perdió falló por una de las razones esperadas (transición inválida o serialización), no por otra.
          for (const r of [validar, descartar]) {
            if (!r.ok) expect(["comprobante_transicion_invalida", undefined], `${r.codigo} ${r.mensaje}`).toContain(r.restriccion);
          }
          const c = (await dueno.query("select estado, numero_reservado::text as numero from comprobante where id = $1", [id])).rows[0];
          const s = await leerSerie(dueno, serie);
          if (c.estado === "DESCARTADO") {
            descartados++;
            expect(c.numero).toBeNull();
            expect(s?.estado === "LIBRE" || s === undefined, JSON.stringify(s)).toBe(true);
          } else if (c.estado === "PENDIENTE") {
            // Bajo SERIALIZABLE pueden abortar los dos (40001): no pasó nada, y la serie no retiene nada.
            expect(aislamiento).toBe("serializable");
            expect(s?.estado === "LIBRE" || s === undefined, JSON.stringify(s)).toBe(true);
            ambosAbortaron++;
          } else {
            validados++;
            expect(c.estado).toBe("EN_VALIDACION");
            expect(s).toMatchObject({ estado: "EN_CURSO", solicitud: id });
          }
        }
        expect(descartados + validados + ambosAbortaron).toBe(20);
      },
    );

    it("cambiar el ambiente del punto de venta MIENTRAS se crea un comprobante: o el comprobante nace antes y conserva su ambiente, o el cambio va primero y el comprobante se rechaza", async () => {
      // A) El alta va primero y retiene el punto de venta: el cambio de ambiente espera.
      {
        const x = await crearEscenario(dueno);
        const alta = await abrir(x, "read committed", x.persona);
        const cambio = await abrir(x, "read committed", x.persona);
        try {
          const datos = datosDeComprobante(x);
          acepta(await insertarComprobante(viaSesion(alta), datos));
          const enEspera = cambio.directo("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]);
          expect(await esperarBloqueo(dueno, cambio.pid)).toBe(true);
          acepta(await alta.confirmar());
          const terminado = await enEspera;
          acepta(terminado);
          acepta(await cambio.confirmar());
          expect((await dueno.query("select ambiente from comprobante where id = $1", [datos["id"]])).rows[0]).toEqual({ ambiente: "HOMOLOGACION" });
          expect((await dueno.query("select ambiente from punto_de_venta where id = $1", [x.pv])).rows[0]).toEqual({ ambiente: "PRODUCCION" });
        } finally {
          await alta.cerrar();
          await cambio.cerrar();
        }
      }
      // B) El cambio va primero: el alta espera, ve el ambiente nuevo y se rechaza.
      {
        const x = await crearEscenario(dueno);
        const cambio = await abrir(x, "read committed", x.persona);
        const alta = await abrir(x, "read committed", x.persona);
        try {
          acepta(await cambio.intentar("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]));
          const datos = datosDeComprobante(x);
          const enEspera = alta.directo(
            `insert into comprobante (${Object.keys(datos).join(", ")}) values (${Object.keys(datos).map((_, i) => `$${i + 1}`).join(", ")})`,
            Object.values(datos),
          );
          expect(await esperarBloqueo(dueno, alta.pid)).toBe(true);
          acepta(await cambio.confirmar());
          check(await enEspera, "comprobante_alta_invalida");
        } finally {
          await cambio.cerrar();
          await alta.cerrar();
        }
      }
    });

    it("crear una serie MIENTRAS se cambia el ambiente de su punto de venta: la serie nace en el ambiente vigente o se rechaza", async () => {
      const x = await crearEscenario(dueno);
      const cambio = await abrir(x, "read committed", x.persona);
      const alta = await abrir(x, "read committed", x.persona);
      try {
        acepta(await cambio.intentar("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [x.pv]));
        const enEspera = alta.directo(
          `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
           values ($1, $2, $3, 'FACTURA_B', 0, 'HOMOLOGACION')`,
          [x.empresa, x.pv, x.emisor],
        );
        expect(await esperarBloqueo(dueno, alta.pid)).toBe(true);
        acepta(await cambio.confirmar());
        check(await enEspera, "serie_ambiente_invalido");
      } finally {
        await cambio.cerrar();
        await alta.cerrar();
      }
    });

    it("dos cargas de certificado para el mismo emisor y ambiente a la vez: uno queda VIGENTE y el otro recibe la violación de certificado_vigente_uk", async () => {
      const x = await crearEscenario(dueno);
      const ids = [randomUUID(), randomUUID()];
      for (const id of ids) {
        await dueno.query(
          `insert into certificado_arca (id, empresa_id, emisor_id, ambiente, alias, cuit_titular, pedido_pem, clave_cifrada,
                                         clave_nonce, clave_etiqueta, clave_kid, creado_por)
           values ($1, $2, $3, 'HOMOLOGACION', 'abc', $4, 'P', $5, $6, $7, 'k', $8)`,
          [id, x.empresa, x.emisor, x.cuit, Buffer.alloc(8), Buffer.alloc(12), Buffer.alloc(16), x.persona],
        );
      }
      const barrera = crearBarrera(2);
      const resultados = await Promise.all(
        ids.map(async (id) => {
          const s = await abrir(x, "read committed", x.persona);
          try {
            await barrera();
            const r = await s.intentar(
              `update certificado_arca set estado = 'VIGENTE', certificado_pem = 'PEM', huella_sha256 = $2, vence_en = now() + interval '1 year' where id = $1`,
              [id, huellaAlAzar()],
            );
            if (!r.ok) return r;
            return await s.confirmar();
          } finally {
            await s.cerrar();
          }
        }),
      );
      expect(resultados.filter((r) => r.ok)).toHaveLength(1);
      const perdedor = resultados.find((r) => !r.ok);
      if (perdedor !== undefined && !perdedor.ok) clave(perdedor, "certificado_vigente_uk");
      expect(
        (await dueno.query("select count(*)::int as n from certificado_arca where empresa_id = $1 and estado = 'VIGENTE'", [x.empresa])).rows[0],
      ).toEqual({ n: 1 });
    });

    it("dos resincronizaciones de la misma serie bloqueada a la vez: una sola la libera (UPDATE ... WHERE estado = 'BLOQUEADA'), y el último número nunca baja", async () => {
      const x = await crearEscenario(dueno);
      const serie = serieDe(x);
      await dueno.query(
        `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
         values ($1, $2, $3, 'FACTURA_B', 5, 'HOMOLOGACION')`,
        [x.empresa, x.pv, x.emisor],
      );
      await dueno.query(
        `update serie_comprobante set estado = 'EN_CURSO', numero_en_curso = 6, solicitud_en_curso = gen_random_uuid(), en_curso_hasta = now() + interval '5 minutes'
          where punto_de_venta_id = $1`,
        [x.pv],
      );
      await dueno.query(
        `update serie_comprobante set estado = 'BLOQUEADA', numero_en_curso = null, solicitud_en_curso = null, en_curso_hasta = null,
                motivo_bloqueo = 'desfase' where punto_de_venta_id = $1`,
        [x.pv],
      );
      const barrera = crearBarrera(2);
      const resultados = await Promise.all(
        [9, 12].map(async (ultimoDeArca) => {
          const s = await abrir(x, "read committed", x.persona);
          try {
            await barrera();
            const r = await s.intentar(
              `update serie_comprobante set estado = 'LIBRE', ultimo_numero = $2, motivo_bloqueo = null
                where punto_de_venta_id = $1 and tipo_comprobante = 'FACTURA_B' and estado = 'BLOQUEADA'`,
              [x.pv, ultimoDeArca],
            );
            if (!r.ok) return { r, ultimoDeArca };
            const c = await s.confirmar();
            return { r: c.ok ? r : c, ultimoDeArca };
          } finally {
            await s.cerrar();
          }
        }),
      );
      const ganadores = resultados.filter((g) => g.r.ok && g.r.filas === 1);
      expect(ganadores).toHaveLength(1);
      expect(resultados.filter((g) => g.r.ok && g.r.filas === 0)).toHaveLength(1);
      expect(await leerSerie(dueno, serie)).toMatchObject({ estado: "LIBRE", ultimo: String(ganadores[0]!.ultimoDeArca) });
    });
  });
});
