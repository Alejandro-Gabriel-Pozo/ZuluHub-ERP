import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cajaParaVentas,
  DATOS_DEL_COBRO,
  datosPendientesDe,
  type DatoDelCobro,
  type EntradaDeRegistrarCobro,
} from "../../src/modulos/caja/publico";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  armarCaja,
  crearEntornoDeCaja,
  type OpcionesDeMundoDeCaja,
} from "./caja-configuracion-apoyo";
import {
  cobrarComoVentas,
  crearMundoDeCobro,
  entradaDeCobro,
  importe,
  origenNuevo,
  type MundoDeCobro,
} from "./caja-cobrar-apoyo";
import { claveNueva, conAhora, instanteLocal, pesos } from "./caja-operacion-apoyo";
import { crearBaseAparte, crearEntornoDePrueba } from "./entorno";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";

/**
 * PR-7-caja con una base real: los datos que «se piden» por medio y el sello de pendientes de cada cobro (0090). Nada se rechaza por un dato
 * que falta (criterio del dueño, 18/11/2026); la base calcula el sello y el rol de la aplicación no puede escribirlo.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const NADIE = { cupon: false, ultimos4: false, marca: false, cuotas: false, dni: false };
type Datos = typeof NADIE;
const MIGRACION = "0090_datos_que_se_piden.sql";
const REVERSION = "reversiones/0090_revertir_datos_que_se_piden.sql";

describe.skipIf(base === null)("datos que se piden y sello de pendientes (0090)", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
  let entorno: ReturnType<typeof crearEntornoDeCaja>;
  let dueno: pg.Client;
  let caja: ReturnType<typeof armarCaja>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entornoBase = crearEntornoDePrueba(propia.base, 4);
    entorno = crearEntornoDeCaja(propia.base, 8);
    caja = armarCaja(entorno);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await entornoBase.cerrar();
    await propia.destruir();
  });

  const casos = () => caja.casos;
  const filas = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;
  const mundo = (opciones: OpcionesDeMundoDeCaja = {}) =>
    crearMundoDeCobro(entornoBase, dueno, caja, opciones);
  const ctxEn = (m: MundoDeCobro, minutos = 5) =>
    conAhora(m.ctx(), new Date(instanteLocal(1, "10:00").getTime() + minutos * 60_000));
  const abrir = async (m: MundoDeCobro) => {
    const r = await casos().abrirSesion(ctxEn(m, 0), {
      claveDeIdempotencia: claveNueva(),
      sucursalId: m.sucursal,
      cajaId: m.cajaId,
      fondoInicial: pesos("1000.00"),
    });
    if (!r.ok) throw new Error(`no se pudo abrir: ${JSON.stringify(r.error)}`);
  };
  const cobrar = (m: MundoDeCobro, cambios: Partial<EntradaDeRegistrarCobro> = {}) =>
    cobrarComoVentas(
      entorno,
      ctxEn(m),
      entradaDeCobro(m, { importe: importe("100.00"), ...cambios }),
    );
  /** Configura un medio por el caso de uso real: qué datos muestra y cuáles «se piden». */
  const configurar = async (
    m: MundoDeCobro,
    tipo: keyof MundoDeCobro["medios"],
    pide: Partial<Datos>,
    sePide: Partial<Datos>,
  ) => {
    const id = m.medios[tipo];
    const [fila] = await filas<{ version: number; nombre: string | null }>(
      "select version, nombre from medio_de_pago where id = $1",
      [id],
    );
    return casos().editarMedioDePago(m.ctx(), {
      medioDePagoId: id,
      versionEsperada: fila?.version as number,
      nombre: fila?.nombre ?? null,
      datos: { ...NADIE, ...pide },
      avisaSiFalta: { ...NADIE, ...sePide },
    });
  };
  const configurarOk = async (...a: Parameters<typeof configurar>) => {
    const r = await configurar(...a);
    if (!r.ok) throw new Error(`no se pudo configurar: ${JSON.stringify(r.error)}`);
  };
  const sello = async (cobroId: string) =>
    (
      await filas<{ datos_pendientes: string[] }>(
        "select datos_pendientes from cobro where movimiento_id = $1",
        [cobroId],
      )
    )[0]?.datos_pendientes;
  const cantidadDeCobros = async (m: MundoDeCobro) =>
    Number(
      (
        await filas<{ n: string }>("select count(*) as n from cobro where empresa_id = $1", [
          m.empresa,
        ])
      )[0]?.n,
    );
  const CREDITO = { cupon: true, ultimos4: true, marca: true, cuotas: true };

  it("cuotas en «se pide»: el cobro sin cuotas entra con el dato pendiente y con cuotas queda sin pendientes", async () => {
    const m = await mundo();
    await abrir(m);
    await configurarOk(m, "TARJETA_CREDITO", CREDITO, { cuotas: true });
    const sin = await cobrar(m, { medioDePagoId: m.medios.TARJETA_CREDITO });
    expect(sin).toMatchObject({
      ok: true,
      valor: { yaExistia: false, datosPendientes: ["cuotas"] },
    });
    expect(await sello(sin.ok ? sin.valor.cobroId : "")).toEqual(["cuotas"]);
    const con = await cobrar(m, { medioDePagoId: m.medios.TARJETA_CREDITO, datos: { cuotas: 3 } });
    expect(con).toMatchObject({ ok: true, valor: { datosPendientes: [] } });
    expect(await sello(con.ok ? con.valor.cobroId : "")).toEqual([]);
  });

  it("dos datos pedidos y uno vacío: solo ese; sin ninguno pedido el sello es vacío; el orden es el fijo de los datos", async () => {
    const m = await mundo();
    await abrir(m);
    await configurarOk(m, "TARJETA_CREDITO", CREDITO, { cuotas: true, cupon: true });
    const uno = await cobrar(m, { medioDePagoId: m.medios.TARJETA_CREDITO, datos: { cuotas: 2 } });
    expect(uno.ok && uno.valor.datosPendientes).toEqual(["cupon"]);
    const dos = await cobrar(m, { medioDePagoId: m.medios.TARJETA_CREDITO });
    expect(dos.ok && dos.valor.datosPendientes).toEqual(["cupon", "cuotas"]);
    const debito = await cobrar(m, { medioDePagoId: m.medios.TARJETA_DEBITO });
    expect(debito.ok && debito.valor.datosPendientes).toEqual([]);
  });

  it("un dato pedido mal escrito se rechaza y no escribe nada (la integridad no cambia)", async () => {
    const m = await mundo();
    await abrir(m);
    await configurarOk(m, "TARJETA_CREDITO", CREDITO, { cuotas: true });
    const r = await cobrar(m, { medioDePagoId: m.medios.TARJETA_CREDITO, datos: { cuotas: 99 } });
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "DATO_DE_COBRO_INVALIDO", dato: "cuotas" },
    });
    expect(await cantidadDeCobros(m)).toBe(0);
  });

  it("pedir un dato que el medio no muestra se rechaza en el dominio y en la base (medio_de_pago_avisa_ck)", async () => {
    const m = await mundo();
    const r = await configurar(m, "TARJETA_CREDITO", { cupon: true }, { cuotas: true });
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "DATO_PEDIDO_SIN_APARECER", dato: "cuotas" },
    });
    await expect(
      dueno.query("update medio_de_pago set avisa_si_falta_dni = true where id = $1", [
        m.medios.TARJETA_CREDITO,
      ]),
    ).rejects.toMatchObject({ constraint: "medio_de_pago_avisa_ck" });
  });

  it("el código no puede escribir el sello: un INSERT del rol de la aplicación que nombra datos_pendientes falla por permisos, y nadie lo cambia después", async () => {
    const m = await mundo();
    await abrir(m);
    const app = new pg.Client({ connectionString: propia.base.app });
    await app.connect();
    try {
      await expect(
        app.query("insert into cobro (datos_pendientes) values ('{}')"),
      ).rejects.toMatchObject({ code: "42501" });
    } finally {
      await app.end();
    }
    const r = await cobrar(m);
    await expect(
      dueno.query("update cobro set datos_pendientes = '{dni}' where movimiento_id = $1", [
        r.ok ? r.valor.cobroId : "",
      ]),
    ).rejects.toThrow();
  });

  it("concurrencia: cobrar sin DNI mientras otra persona lo pasa a «se pide» → las dos terminan, nunca un cobro rechazado, y el sello es el de un orden posible", async () => {
    const m = await mundo();
    await abrir(m);
    await configurarOk(m, "TRANSFERENCIA", { dni: true }, {});
    const [cobro, edicion] = await Promise.all([
      cobrar(m, { medioDePagoId: m.medios.TRANSFERENCIA }),
      configurar(m, "TRANSFERENCIA", { dni: true }, { dni: true }),
    ]);
    expect(edicion.ok).toBe(true);
    expect(cobro.ok).toBe(true);
    const marcado = await sello(cobro.ok ? cobro.valor.cobroId : "");
    expect([[], ["dni"]]).toContainEqual(marcado);
    // Y ya con la configuración nueva firme, el siguiente cobro sin DNI queda pendiente: nunca rechazado.
    const despues = await cobrar(m, { medioDePagoId: m.medios.TRANSFERENCIA });
    expect(despues.ok && despues.valor.datosPendientes).toEqual(["dni"]);
  });

  it("idempotencia: repetir el cobro después de cambiar la configuración devuelve el original con su sello original", async () => {
    const m = await mundo();
    await abrir(m);
    await configurarOk(m, "TARJETA_CREDITO", CREDITO, { cuotas: true });
    const entrada = entradaDeCobro(m, {
      medioDePagoId: m.medios.TARJETA_CREDITO,
      origen: origenNuevo(),
    });
    const primera = await cobrarComoVentas(entorno, ctxEn(m), entrada);
    expect(primera.ok && primera.valor.datosPendientes).toEqual(["cuotas"]);
    await configurarOk(m, "TARJETA_CREDITO", CREDITO, {});
    const repetida = await cobrarComoVentas(entorno, ctxEn(m, 6), entrada);
    expect(repetida).toMatchObject({
      ok: true,
      valor: { yaExistia: true, datosPendientes: ["cuotas"] },
    });
    expect(await cantidadDeCobros(m)).toBe(1);
    // Al revés: sellado vacío, se pasa a «se pide» y se repite: sigue vacío.
    const otra = entradaDeCobro(m, {
      medioDePagoId: m.medios.TARJETA_CREDITO,
      origen: origenNuevo(),
    });
    const a = await cobrarComoVentas(entorno, ctxEn(m, 7), otra);
    expect(a.ok && a.valor.datosPendientes).toEqual([]);
    await configurarOk(m, "TARJETA_CREDITO", CREDITO, { cuotas: true });
    const b = await cobrarComoVentas(entorno, ctxEn(m, 8), otra);
    expect(b).toMatchObject({ ok: true, valor: { yaExistia: true, datosPendientes: [] } });
  });

  it("las lecturas entregan el sello: cobrosPorOrigen y opcionesDeCobro (datosQuePide no cambia de forma)", async () => {
    const m = await mundo();
    await abrir(m);
    await configurarOk(m, "TARJETA_CREDITO", CREDITO, { cuotas: true, marca: true });
    const origen = origenNuevo();
    const r = await cobrarComoVentas(
      entorno,
      ctxEn(m),
      entradaDeCobro(m, { medioDePagoId: m.medios.TARJETA_CREDITO, origen }),
    );
    expect(r.ok).toBe(true);
    const lectura = await entorno.ejecutar(
      { contexto: ctxEn(m), aislamiento: "read committed", soloLectura: true },
      async (tx) =>
        ok({
          porOrigen: await cajaParaVentas.cobrosPorOrigen(tx, ctxEn(m), origen),
          opciones: await cajaParaVentas.opcionesDeCobro(tx, ctxEn(m), m.cajaId),
        }),
    );
    if (!lectura.ok) throw new Error(JSON.stringify(lectura));
    expect(lectura.valor.porOrigen.cobros[0]?.datosPendientes).toEqual(["marca", "cuotas"]);
    const credito = lectura.valor.opciones.ok
      ? lectura.valor.opciones.valor.medios.find((o) => o.id === m.medios.TARJETA_CREDITO)
      : undefined;
    expect(credito?.datosQuePide).toEqual({ ...NADIE, ...CREDITO });
    expect(credito?.datosQueSePiden).toEqual({ ...NADIE, marca: true, cuotas: true });
  });

  it("editar el medio: versión vieja → rechazo, auditoría con antes y después, y dos ediciones a la vez → una gana", async () => {
    const m = await mundo();
    await configurarOk(m, "TARJETA_CREDITO", CREDITO, { cuotas: true });
    const [fila] = await filas<{ version: number }>(
      "select version from medio_de_pago where id = $1",
      [m.medios.TARJETA_CREDITO],
    );
    const vieja = await casos().editarMedioDePago(m.ctx(), {
      medioDePagoId: m.medios.TARJETA_CREDITO,
      versionEsperada: (fila?.version as number) - 1,
      nombre: null,
      datos: { ...NADIE, ...CREDITO },
      avisaSiFalta: { ...NADIE, marca: true },
    });
    expect(vieja).toMatchObject({ ok: false, error: "VERSION_DESACTUALIZADA" });
    const auditorias = await filas<{
      antes: Record<string, unknown>;
      despues: Record<string, unknown>;
    }>(
      "select antes, despues from auditoria_empresa where empresa_id = $1 and accion = 'MEDIO_DE_PAGO_EDITADO' and entidad_id = $2",
      [m.empresa, m.medios.TARJETA_CREDITO],
    );
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]?.antes).toMatchObject({ sePide: { cuotas: false } });
    expect(auditorias[0]?.despues).toMatchObject({ sePide: { cuotas: true } });
    const pedido = (sePide: Partial<Datos>) =>
      casos().editarMedioDePago(m.ctx(), {
        medioDePagoId: m.medios.TARJETA_CREDITO,
        versionEsperada: fila?.version as number,
        nombre: null,
        datos: { ...NADIE, ...CREDITO },
        avisaSiFalta: { ...NADIE, ...sePide },
      });
    const resultados = await Promise.all([pedido({ marca: true }), pedido({ cupon: true })]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
  });

  it("paridad: datosPendientesDe da lo mismo que la base y el CHECK del sello lista los cinco datos", async () => {
    const m = await mundo();
    await abrir(m);
    const casosDeParidad: readonly Readonly<{
      sePide: Partial<Datos>;
      datos: EntradaDeRegistrarCobro["datos"];
    }>[] = [
      { sePide: {}, datos: {} },
      { sePide: { cupon: true }, datos: {} },
      { sePide: { cupon: true }, datos: { cupon: "ZX-1" } },
      { sePide: { ultimos4: true, cuotas: true }, datos: { ultimos4: "1234" } },
      { sePide: { cupon: true, ultimos4: true, cuotas: true }, datos: { cuotas: 12 } },
      { sePide: { cuotas: true }, datos: { cuotas: 1, cupon: "A" } },
    ];
    for (const caso of casosDeParidad) {
      await configurarOk(m, "TARJETA_CREDITO", CREDITO, caso.sePide);
      const r = await cobrar(m, { medioDePagoId: m.medios.TARJETA_CREDITO, datos: caso.datos });
      expect(r.ok).toBe(true);
      expect(r.ok && r.valor.datosPendientes).toEqual([
        ...datosPendientesDe({ ...NADIE, ...caso.sePide }, caso.datos),
      ]);
    }
    const [def] = await filas<{ def: string }>(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'cobro_datos_pendientes_ck'",
    );
    for (const dato of DATOS_DEL_COBRO as readonly DatoDelCobro[]) {
      expect(def?.def).toContain(`'${dato}'`);
    }
  });

  it("reversión: aplicar, revertir (en una base sin datos) y volver a aplicar deja las columnas y el sello funcionando", async () => {
    const propiaAparte = await crearBaseAparte(base as NonNullable<typeof base>);
    const cliente = new pg.Client({ connectionString: propiaAparte.base.dueno });
    await cliente.connect();
    try {
      const reversion = await readFile(join(CARPETA_DE_MIGRACIONES, REVERSION), "utf8");
      const migracion = await readFile(join(CARPETA_DE_MIGRACIONES, MIGRACION), "utf8");
      const columnas = async () =>
        Number(
          (
            await cliente.query<{ n: string }>(
              "select count(*) as n from information_schema.columns where table_name in ('medio_de_pago', 'cobro') and column_name in ('avisa_si_falta_cupon', 'avisa_si_falta_dni', 'datos_pendientes')",
            )
          ).rows[0]?.n,
        );
      expect(await columnas()).toBe(3);
      await cliente.query(reversion);
      expect(await columnas()).toBe(0);
      await cliente.query(migracion);
      expect(await columnas()).toBe(3);
      await cliente.query(reversion);
      await cliente.query(migracion);
      expect(await columnas()).toBe(3);
    } finally {
      await cliente.end();
      await propiaAparte.destruir();
    }
  });
});
