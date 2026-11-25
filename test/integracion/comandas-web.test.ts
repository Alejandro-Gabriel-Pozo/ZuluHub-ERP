import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  anularUnItemEnviado,
  cambiarLaSalida,
  enviarALaCocina,
  pedirQueSalga,
  quitarUnPlatoSinEnviar,
  type DependenciasDeComandasWeb,
} from "../../src/composicion/comandas-web";
import {
  declararElResultadoDeImpresion,
  desactivarLaImpresora,
  editarLaImpresora,
  pedirLaImpresion,
  pedirUnaCopia,
  registrarLaImpresora,
  verElPapelDelDocumento,
  verLasImpresoras,
  verLosTrabajosDeImpresion,
  type DependenciasDeImpresionWeb,
} from "../../src/composicion/impresion-web";
import {
  crearCasosDeUsoDeComandas,
  crearConsultasDeComandas,
  type TxDeComandas,
  type TxDeConsultasDeComandas,
} from "../../src/modulos/comandas/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { agotadaSegunElRegistro, repetirSiAgotada } from "./concurrencia-apoyo";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * Las comandas y la impresión de la web (`comandas-web.ts`, S-0r) contra una base real y los roles reales: enviar a cocina, pedir que salga, anular un ítem enviado, el orden de salida, las impresoras
 * y los trabajos. Lo que se prueba: repetir con el mismo id no duplica (envío, aviso, impresora, trabajo, resultado), dos mozos a la vez dejan un solo envío, la sucursal la fija el servidor (vacía cierra; una cuenta
 * o una impresora de otra sucursal o empresa no existe), el permiso lo decide el servidor (el operador no administra impresoras) y todo error del negocio sale como el genérico, sin huella ni clave de un trabajo.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";
const codigo = (r: { ok: boolean; error?: { codigo: string } }) =>
  r.ok ? null : (r.error?.codigo ?? null);

describe.skipIf(base === null)("comandas e impresión de la web", () => {
  let m: MundoDeSalon;
  let e: EscenarioDeVentas;
  let registrados: string[];
  let d: DependenciasDeComandasWeb;
  let di: DependenciasDeImpresionWeb;
  let proxima = 0;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
    e = await m.escenario();
    registrados = [];
    const transacciones = m.entorno as unknown as Transacciones<TxDeComandas>;
    const casosDeComandas = crearCasosDeUsoDeComandas({ transacciones, reglas: m.reglas });
    d = {
      casosDeUsoDeSalon: () => m.salon,
      casosDeUso: () => casosDeComandas,
      consultasDeSalon: () => m.consultasDeSalon,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
    di = {
      casosDeUso: () => casosDeComandas,
      consultas: () =>
        crearConsultasDeComandas({
          transacciones: m.entorno as unknown as Transacciones<TxDeConsultasDeComandas>,
          reglas: m.reglas,
        }),
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const repetir = <R extends { ok: boolean; error?: { codigo?: unknown } }>(
    trabajo: () => Promise<R>,
  ) => repetirSiAgotada(trabajo, { esAgotada: agotadaSegunElRegistro(registrados) });

  const mesasPorEmpresa = new Map<string, number>();
  /** Una cuenta de mesa con `n` platos (cada uno con su salida) en la sucursal del escenario. */
  const cuentaConPlatos = async (
    salidas: readonly ("AHORA" | "DESPUES")[],
    escenario = e,
  ): Promise<{ cuenta: string; lineas: string[] }> => {
    // El número de mesa sigue por empresa: el salón es de 14 × 9 (35 mesas en esta grilla) y cada empresa tiene el suyo.
    const n = (mesasPorEmpresa.get(escenario.empresa) ?? 0) + 1;
    mesasPorEmpresa.set(escenario.empresa, n);
    const mesaId = nuevoId();
    valorDe(
      await m.salon.crearMesa(escenario.gerente, {
        mesaId,
        sucursalId: escenario.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    const cuenta = valorDe(
      await m.salon.tomarPedido(escenario.gerente, { cuentaId: nuevoId(), mesaId }),
    ).cuentaId;
    const lineas: string[] = [];
    for (const salida of salidas) {
      const lineaId = nuevoId();
      valorDe(
        await m.salon.agregarAlPedido(escenario.gerente, {
          cuentaId: cuenta,
          lineaId,
          productoId: escenario.producto,
          opcionIds: [],
          cantidad: "2",
          salida,
        }),
      );
      lineas.push(lineaId);
    }
    return { cuenta, lineas };
  };
  const enviar = (cuentaId: string, pedido: Record<string, unknown> = {}, contexto = e.gerente) =>
    enviarALaCocina(d, contexto, e.sucursal, {
      envioId: nuevoId(),
      cuentaId,
      claveIdempotencia: nuevaClave(),
      ...pedido,
    });
  const cuantos = (tabla: string, columna: string, valor: string) =>
    m.contar(`select count(*) as n from ${tabla} where ${columna} = $1`, [valor]);

  it("«Enviar a cocina»: el envío sale numerado, con lo declarado y sin impresora no se bloquea", async () => {
    const { cuenta } = await cuentaConPlatos(["AHORA", "DESPUES"]);
    const r = await enviar(cuenta);
    expect(r).toMatchObject({
      ok: true,
      dato: { numero: 1, lineas: 1, sinImpresora: true, yaExistia: false },
    });
    if (!r.ok) return;
    expect(Object.keys(r.dato).sort()).toEqual(
      [
        "envioId",
        "ignoradas",
        "lineas",
        "numero",
        "sinImpresora",
        "tipo",
        "trabajoId",
        "yaExistia",
      ].sort(),
    );
  });

  it("IDEMPOTENCIA: enviar dos veces con el mismo id es un solo envío y un solo trabajo de impresión", async () => {
    const { cuenta } = await cuentaConPlatos(["AHORA"]);
    const pedido = { envioId: nuevoId(), claveIdempotencia: nuevaClave() };
    const primero = await enviar(cuenta, pedido);
    const segundo = await enviar(cuenta, pedido);
    expect(primero).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(segundo).toMatchObject({ ok: true, dato: { yaExistia: true } });
    expect(primero.ok && segundo.ok && primero.dato.trabajoId === segundo.dato.trabajoId).toBe(
      true,
    );
    expect(await cuantos("envio_de_comanda", "cuenta_id", cuenta)).toBe(1);
    const auditadas = (await m.auditoria(e.empresa, "ENVIO_REGISTRADO")).filter(
      (a) => a["entidad_id"] === pedido.envioId,
    );
    expect(auditadas).toHaveLength(1);
  });

  it("CONCURRENCIA: dos mozos envían la misma cuenta a la vez: un solo envío, el otro recibe el genérico (nada para enviar), no un envío vacío", async () => {
    const { cuenta } = await cuentaConPlatos(["AHORA", "AHORA"]);
    const [a, b] = await Promise.all([
      repetir(() => enviar(cuenta, {}, e.gerente)),
      repetir(() => enviar(cuenta, {}, e.administrador)),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(codigo(a.ok ? b : a)).toBe(GENERICO);
    expect(await cuantos("envio_de_comanda", "cuenta_id", cuenta)).toBe(1);
  });

  it("«Pedir que salga»: los platos en espera salen en un envío más; repetirlo no duplica", async () => {
    const { cuenta, lineas } = await cuentaConPlatos(["AHORA", "DESPUES"]);
    await enviar(cuenta);
    const pedido = {
      envioId: nuevoId(),
      cuentaId: cuenta,
      lineaIds: "TODAS",
      claveIdempotencia: nuevaClave(),
    };
    const primero = await pedirQueSalga(d, e.gerente, e.sucursal, pedido);
    const segundo = await pedirQueSalga(d, e.gerente, e.sucursal, pedido);
    expect(primero).toMatchObject({
      ok: true,
      dato: { numero: 2, tipo: "SALIDA_PEDIDA", lineas: 1, yaExistia: false },
    });
    expect(segundo).toMatchObject({ ok: true, dato: { numero: 2, yaExistia: true } });
    expect(await cuantos("envio_de_comanda", "cuenta_id", cuenta)).toBe(2);
    // Sin nada que pedir: el genérico. Con una lista vacía o de ids mal formados: el genérico.
    expect(
      codigo(
        await pedirQueSalga(d, e.gerente, e.sucursal, {
          ...pedido,
          envioId: nuevoId(),
          claveIdempotencia: nuevaClave(),
        }),
      ),
    ).toBe(GENERICO);
    expect(codigo(await pedirQueSalga(d, e.gerente, e.sucursal, { ...pedido, lineaIds: [] }))).toBe(
      GENERICO,
    );
    expect(
      codigo(await pedirQueSalga(d, e.gerente, e.sucursal, { ...pedido, lineaIds: ["x"] })),
    ).toBe(GENERICO);
    expect(lineas).toHaveLength(2);
  });

  it("orden de salida: cambia mientras no se envió, repetirlo devuelve yaEstaba y con el plato enviado es el genérico", async () => {
    const { cuenta, lineas } = await cuentaConPlatos(["AHORA"]);
    const lineaId = lineas[0] as string;
    const cambiar = (salida: string) =>
      cambiarLaSalida(d, e.gerente, e.sucursal, { cuentaId: cuenta, lineaId, salida });
    expect(await cambiar("DESPUES")).toMatchObject({
      ok: true,
      dato: { salida: "DESPUES", yaEstaba: false },
    });
    expect(await cambiar("DESPUES")).toMatchObject({ ok: true, dato: { yaEstaba: true } });
    expect(await cambiar("AHORA")).toMatchObject({
      ok: true,
      dato: { salida: "AHORA", yaEstaba: false },
    });
    expect(codigo(await cambiar("CUANDO_QUIERA"))).toBe(GENERICO);
    await enviar(cuenta);
    expect(codigo(await cambiar("DESPUES"))).toBe(GENERICO);
  });

  it("«Quitar» un plato sin enviar: sin motivo, sin papel; repetir es yaEstabaQuitada y audita una vez; el plato queda ANULADO, no se borra", async () => {
    const { cuenta, lineas } = await cuentaConPlatos(["AHORA", "DESPUES"]);
    const lineaId = lineas[1] as string;
    const quitar = (id = lineaId, pedido: Record<string, unknown> = {}) =>
      quitarUnPlatoSinEnviar(d, e.gerente, e.sucursal, {
        cuentaId: cuenta,
        lineaId: id,
        ...pedido,
      });
    expect(await quitar()).toMatchObject({ ok: true, dato: { yaEstabaQuitada: false } });
    expect(await quitar()).toMatchObject({ ok: true, dato: { yaEstabaQuitada: true } });
    const estados = await m.filas<{
      id: string;
      estado: string;
      motivo_de_anulacion: string | null;
    }>(
      "select id, estado, motivo_de_anulacion from linea_cuenta where cuenta_id = $1 order by posicion",
      [cuenta],
    );
    expect(estados.map((l) => l.estado)).toEqual(["VIGENTE", "ANULADA"]);
    expect(estados[1]?.motivo_de_anulacion).toBe("SIN_ENVIAR");
    const auditadas = (await m.auditoria(e.empresa, "LINEA_ANULADA")).filter(
      (a) => a["entidad_id"] === lineaId,
    );
    expect(auditadas).toHaveLength(1);
    expect(await cuantos("envio_de_comanda", "cuenta_id", cuenta)).toBe(0);
    // Un motivo que mande el navegador se descarta: el motivo es interno.
    const ajena = await cuentaConPlatos(["AHORA"]);
    expect(
      await quitarUnPlatoSinEnviar(d, e.gerente, e.sucursal, {
        cuentaId: ajena.cuenta,
        lineaId: ajena.lineas[0],
        motivo: "me dio la gana",
      }),
    ).toMatchObject({ ok: true });
    const motivo = await m.filas<{ motivo_de_anulacion: string }>(
      "select motivo_de_anulacion from linea_cuenta where id = $1",
      [ajena.lineas[0]],
    );
    expect(motivo[0]?.motivo_de_anulacion).toBe("SIN_ENVIAR");
  });

  it("«Quitar» un plato ya enviado, de otra cuenta o inexistente es el genérico y no escribe", async () => {
    const { cuenta, lineas } = await cuentaConPlatos(["AHORA", "DESPUES"]);
    expect((await enviar(cuenta)).ok).toBe(true);
    const quitar = (cuentaId: string, lineaId: string) =>
      quitarUnPlatoSinEnviar(d, e.gerente, e.sucursal, { cuentaId, lineaId });
    expect(codigo(await quitar(cuenta, lineas[0] as string))).toBe(GENERICO);
    const otraCuenta = await cuentaConPlatos(["AHORA"]);
    expect(codigo(await quitar(cuenta, otraCuenta.lineas[0] as string))).toBe(GENERICO);
    expect(codigo(await quitar(cuenta, nuevoId()))).toBe(GENERICO);
    expect(codigo(await quitar(cuenta, "no-es-un-id"))).toBe(GENERICO);
    const vigentes = await m.contar(
      "select count(*) as n from linea_cuenta where cuenta_id = $1 and estado = 'VIGENTE'",
      [cuenta],
    );
    expect(vigentes).toBe(2);
    // El que esperaba (sale después) sigue sin enviar y sí se puede quitar.
    expect(await quitar(cuenta, lineas[1] as string)).toMatchObject({ ok: true });
  });

  it("CONCURRENCIA: quitar a la vez que otro envía: o se quita o se envía, nunca las dos cosas", async () => {
    for (let i = 0; i < 3; i++) {
      const { cuenta, lineas } = await cuentaConPlatos(["AHORA", "AHORA"]);
      const lineaId = lineas[0] as string;
      const [quitado, enviado] = await Promise.all([
        repetir(() =>
          quitarUnPlatoSinEnviar(d, e.gerente, e.sucursal, { cuentaId: cuenta, lineaId }),
        ),
        repetir(() => enviar(cuenta, {}, e.administrador)),
      ]);
      const fila = await m.filas<{ estado: string; envio_id: string | null }>(
        "select l.estado, c.envio_id from linea_cuenta l join linea_de_comanda c on c.linea_id = l.id where l.id = $1",
        [lineaId],
      );
      const [una] = fila;
      expect(una).toBeDefined();
      // Nunca un plato anulado y enviado a la vez.
      expect(una?.estado === "ANULADA" && una.envio_id !== null).toBe(false);
      if (quitado.ok) expect(una?.estado).toBe("ANULADA");
      else expect(codigo(quitado)).toBe(GENERICO);
      expect(enviado.ok || codigo(enviado) === GENERICO).toBe(true);
    }
  });

  it("«Quitar»: la sucursal la fija el servidor; sin sucursal, de otra sucursal o de otra empresa es el genérico; sin persona no escribe", async () => {
    const { cuenta, lineas } = await cuentaConPlatos(["AHORA"]);
    const lineaId = lineas[0] as string;
    expect(
      codigo(await quitarUnPlatoSinEnviar(d, e.gerente, "", { cuentaId: cuenta, lineaId })),
    ).toBe(GENERICO);
    expect(
      codigo(
        await quitarUnPlatoSinEnviar(d, e.gerente, e.otraSucursal, { cuentaId: cuenta, lineaId }),
      ),
    ).toBe(GENERICO);
    const otra = await m.escenario();
    const ajena = await cuentaConPlatos(["AHORA"], otra);
    expect(
      codigo(
        await quitarUnPlatoSinEnviar(d, e.gerente, e.sucursal, {
          cuentaId: ajena.cuenta,
          lineaId: ajena.lineas[0],
        }),
      ),
    ).toBe(GENERICO);
    expect(
      (
        await quitarUnPlatoSinEnviar(d, { ...e.gerente, personaId: null }, e.sucursal, {
          cuentaId: cuenta,
          lineaId,
        })
      ).ok,
    ).toBe(false);
    const vigentes = await m.contar(
      "select count(*) as n from linea_cuenta where id = $1 and estado = 'VIGENTE'",
      [lineaId],
    );
    expect(vigentes).toBe(1);
    expect(
      await m.contar(
        "select count(*) as n from linea_cuenta where id = $1 and estado = 'VIGENTE'",
        [ajena.lineas[0] as string],
      ),
    ).toBe(1);
  });

  it("«Anular» un ítem enviado: con motivo, parcial; repetir con el mismo avisoId es un solo aviso; sin motivo o de más es el genérico", async () => {
    const { cuenta, lineas } = await cuentaConPlatos(["AHORA"]);
    await enviar(cuenta);
    const pedido = {
      cuentaId: cuenta,
      lineaId: lineas[0] as string,
      cantidad: "1",
      motivo: "Error del mozo",
      avisoId: nuevoId(),
    };
    const primero = await anularUnItemEnviado(d, e.gerente, e.sucursal, pedido);
    const segundo = await anularUnItemEnviado(d, e.gerente, e.sucursal, pedido);
    expect(primero).toMatchObject({
      ok: true,
      dato: { avisoId: pedido.avisoId, quedan: "1.0000", yaExistia: false },
    });
    expect(segundo).toMatchObject({ ok: true, dato: { yaExistia: true } });
    expect(await cuantos("aviso_de_anulacion", "cuenta_id", cuenta)).toBe(1);
    // Con otro aviso para la MISMA línea ya anulada devuelve el aviso que ya existe (no abre otro). Sin motivo, o una cantidad que no se puede anular, en una línea vigente: el genérico y nada se escribe.
    expect(
      await anularUnItemEnviado(d, e.gerente, e.sucursal, { ...pedido, avisoId: nuevoId() }),
    ).toMatchObject({ ok: true, dato: { avisoId: pedido.avisoId, yaExistia: true } });
    const nueva = await cuentaConPlatos(["AHORA"]);
    await enviar(nueva.cuenta);
    const otro = {
      ...pedido,
      cuentaId: nueva.cuenta,
      lineaId: nueva.lineas[0] as string,
      avisoId: nuevoId(),
    };
    expect(
      codigo(await anularUnItemEnviado(d, e.gerente, e.sucursal, { ...otro, motivo: "" })),
    ).toBe(GENERICO);
    expect(
      codigo(await anularUnItemEnviado(d, e.gerente, e.sucursal, { ...otro, cantidad: "99" })),
    ).toBe(GENERICO);
    expect(
      codigo(await anularUnItemEnviado(d, e.gerente, e.sucursal, { ...otro, cantidad: 1 })),
    ).toBe(GENERICO);
    expect(await cuantos("aviso_de_anulacion", "cuenta_id", cuenta)).toBe(1);
    expect(await cuantos("aviso_de_anulacion", "cuenta_id", nueva.cuenta)).toBe(0);
  });

  it("SUCURSAL: la fija el servidor; vacía cierra y una cuenta de otra sucursal o empresa no existe (no se envía nada)", async () => {
    const { cuenta, lineas } = await cuentaConPlatos(["AHORA"]);
    expect(
      codigo(
        await enviarALaCocina(d, e.gerente, "", {
          envioId: nuevoId(),
          cuentaId: cuenta,
          claveIdempotencia: nuevaClave(),
        }),
      ),
    ).toBe(GENERICO);
    expect(
      codigo(
        await enviarALaCocina(d, e.gerente, e.otraSucursal, {
          envioId: nuevoId(),
          cuentaId: cuenta,
          claveIdempotencia: nuevaClave(),
        }),
      ),
    ).toBe(GENERICO);
    expect(
      codigo(
        await cambiarLaSalida(d, e.gerente, e.otraSucursal, {
          cuentaId: cuenta,
          lineaId: lineas[0],
          salida: "DESPUES",
        }),
      ),
    ).toBe(GENERICO);
    const otra = await m.escenario();
    expect(codigo(await enviar(cuenta, {}, otra.gerente))).not.toBeNull();
    const ajena = await cuentaConPlatos(["AHORA"], otra);
    expect(
      codigo(
        await enviarALaCocina(d, e.gerente, e.sucursal, {
          envioId: nuevoId(),
          cuentaId: ajena.cuenta,
          claveIdempotencia: nuevaClave(),
        }),
      ),
    ).toBe(GENERICO);
    expect(await cuantos("envio_de_comanda", "cuenta_id", cuenta)).toBe(0);
    expect(await cuantos("envio_de_comanda", "cuenta_id", ajena.cuenta)).toBe(0);
  });

  it("PERMISOS: sin persona en el contexto o con el pedido mal formado no se escribe nada; ids o claves inválidos son el genérico", async () => {
    const { cuenta } = await cuentaConPlatos(["AHORA"]);
    expect((await enviar(cuenta, {}, { ...e.gerente, personaId: null })).ok).toBe(false);
    expect(codigo(await enviar(cuenta, { envioId: "no-es-un-id" }))).toBe(GENERICO);
    expect(codigo(await enviar(cuenta, { claveIdempotencia: "corta" }))).toBe(GENERICO);
    expect(await cuantos("envio_de_comanda", "cuenta_id", cuenta)).toBe(0);
    // El rótulo del papel no viaja en el pedido: lo que mande el navegador se descarta y lo arma el servidor desde la mesa.
    expect((await enviar(cuenta, { rotulo: "<script>" }, e.operador)).ok).toBe(true);
    const rotulos = await m.filas<{ rotulo: string }>(
      "select rotulo from envio_de_comanda where cuenta_id = $1",
      [cuenta],
    );
    expect(rotulos.map((r) => r.rotulo)).toEqual([expect.stringMatching(/^Mesa \d+$/)]);
  });

  describe("impresoras", () => {
    const alta = (
      extra: Record<string, unknown> = {},
      contexto = e.gerente,
      sucursal = e.sucursal,
    ) =>
      registrarLaImpresora(di, contexto, sucursal, {
        impresoraId: nuevoId(),
        nombre: `Cocina ${++proxima}`,
        uso: "COMANDA",
        papelMm: 80,
        ...extra,
      });

    it("la lista trae solo lo declarado, activas y desactivadas, de la sucursal de trabajo", async () => {
      const id = nuevoId();
      expect(await alta({ impresoraId: id })).toMatchObject({ ok: true });
      const otra = await alta({}, e.gerente, e.otraSucursal);
      expect(otra.ok).toBe(true);
      const lista = await verLasImpresoras(di, e.operador, e.sucursal);
      expect(lista).toMatchObject({ ok: true });
      if (!lista.ok) return;
      const impresora = lista.dato.impresoras.find((x) => x.id === id);
      expect(Object.keys(impresora ?? {}).sort()).toEqual(
        ["activa", "id", "nombre", "papelMm", "uso", "version"].sort(),
      );
      expect(otra.ok && lista.dato.impresoras.some((x) => x.id === otra.dato.impresoraId)).toBe(
        false,
      );
      expect(codigo(await verLasImpresoras(di, e.gerente, ""))).toBe(GENERICO);
    });

    it("IDEMPOTENCIA: guardar dos veces el alta es una sola impresora; otro nombre repetido o un papel inexistente es el genérico", async () => {
      const impresoraId = nuevoId();
      const datos = { impresoraId, nombre: "Barra", uso: "COMANDA", papelMm: 58 };
      expect(await registrarLaImpresora(di, e.gerente, e.sucursal, datos)).toMatchObject({
        ok: true,
        dato: { yaExistia: false },
      });
      expect(await registrarLaImpresora(di, e.gerente, e.sucursal, datos)).toMatchObject({
        ok: true,
        dato: { yaExistia: true },
      });
      expect(await cuantos("impresora", "id", impresoraId)).toBe(1);
      expect(codigo(await alta({ nombre: "Barra" }))).toBe(GENERICO);
      expect(codigo(await alta({ papelMm: 70 }))).toBe(GENERICO);
      expect(codigo(await alta({ uso: "OTRO" }))).toBe(GENERICO);
      expect(codigo(await alta({ papelMm: "80" as unknown as number }))).toBeNull();
    });

    it("PERMISOS: el operador mira pero no crea, edita ni desactiva (decide el servidor)", async () => {
      const id = nuevoId();
      await alta({ impresoraId: id });
      const antes = await m.contar("select count(*) as n from impresora where sucursal_id = $1", [
        e.sucursal,
      ]);
      expect((await alta({}, e.operador)).ok).toBe(false);
      expect(
        (
          await editarLaImpresora(di, e.operador, e.sucursal, {
            impresoraId: id,
            nombre: "Otra",
            versionEsperada: 1,
          })
        ).ok,
      ).toBe(false);
      expect(
        (await desactivarLaImpresora(di, e.operador, e.sucursal, { impresoraId: id })).ok,
      ).toBe(false);
      expect(
        await m.contar("select count(*) as n from impresora where sucursal_id = $1", [e.sucursal]),
      ).toBe(antes);
      expect(
        await m.contar("select count(*) as n from impresora where id = $1 and activa", [id]),
      ).toBe(1);
    });

    it("CONCURRENCIA: editar con una versión vieja no escribe; desactivar repetido no audita de nuevo", async () => {
      const id = nuevoId();
      await alta({ impresoraId: id });
      const editar = (version: number, nombre: string, contexto = e.gerente) =>
        editarLaImpresora(di, contexto, e.sucursal, {
          impresoraId: id,
          nombre,
          versionEsperada: version,
        });
      expect(await editar(1, "Nueva")).toMatchObject({ ok: true, dato: { version: 2 } });
      expect(codigo(await editar(1, "Pisada", e.administrador))).toBe(GENERICO);
      const lista = await verLasImpresoras(di, e.gerente, e.sucursal);
      expect(lista.ok && lista.dato.impresoras.find((x) => x.id === id)?.nombre).toBe("Nueva");
      expect(
        await desactivarLaImpresora(di, e.gerente, e.sucursal, { impresoraId: id }),
      ).toMatchObject({ ok: true, dato: { yaEstabaDesactivada: false } });
      expect(
        await desactivarLaImpresora(di, e.gerente, e.sucursal, { impresoraId: id }),
      ).toMatchObject({ ok: true, dato: { yaEstabaDesactivada: true } });
      const auditadas = (await m.auditoria(e.empresa, "IMPRESORA_DESACTIVADA")).filter(
        (a) => a["entidad_id"] === id,
      );
      expect(auditadas).toHaveLength(1);
    });

    it("AISLAMIENTO: la impresora de otra sucursal o empresa no se edita ni se desactiva", async () => {
      const deOtraSucursal = await alta({}, e.gerente, e.otraSucursal);
      expect(deOtraSucursal.ok).toBe(true);
      if (!deOtraSucursal.ok) return;
      const id = deOtraSucursal.dato.impresoraId;
      expect(
        codigo(
          await editarLaImpresora(di, e.gerente, e.sucursal, {
            impresoraId: id,
            nombre: "Robada",
            versionEsperada: 1,
          }),
        ),
      ).toBe(GENERICO);
      expect(
        codigo(await desactivarLaImpresora(di, e.gerente, e.sucursal, { impresoraId: id })),
      ).toBe(GENERICO);
      const otra = await m.escenario();
      const ajena = await alta({}, otra.gerente, otra.sucursal);
      expect(ajena.ok).toBe(true);
      if (!ajena.ok) return;
      expect(
        codigo(
          await desactivarLaImpresora(di, e.gerente, e.sucursal, {
            impresoraId: ajena.dato.impresoraId,
          }),
        ),
      ).toBe(GENERICO);
      expect(
        await m.contar("select count(*) as n from impresora where id = any($1) and activa", [
          [id, ajena.dato.impresoraId],
        ]),
      ).toBe(2);
    });
  });

  describe("trabajos de impresión", () => {
    const imprimir = (
      documentoId: string,
      extra: Record<string, unknown> = {},
      contexto = e.gerente,
    ) =>
      pedirLaImpresion(di, contexto, e.sucursal, {
        trabajoId: nuevoId(),
        documentoTipo: "COMANDA",
        documentoId,
        claveIdempotencia: nuevaClave(),
        ...extra,
      });

    it("«Imprimir»: repetir con el mismo trabajo es uno solo; declarar el resultado es idempotente y uno distinto es el genérico", async () => {
      expect(
        await registrarLaImpresora(di, e.gerente, e.sucursal, {
          impresoraId: nuevoId(),
          nombre: `Cocina ${++proxima}`,
          uso: "COMANDA",
          papelMm: 80,
        }),
      ).toMatchObject({ ok: true });
      const { cuenta } = await cuentaConPlatos(["AHORA"]);
      const envio = await enviar(cuenta);
      expect(envio).toMatchObject({ ok: true, dato: { sinImpresora: false } });
      if (!envio.ok) return;
      const documentoId = envio.dato.envioId;
      const pedido = {
        trabajoId: envio.dato.trabajoId,
        documentoTipo: "COMANDA",
        documentoId,
        claveIdempotencia: nuevaClave(),
      };
      const primero = await pedirLaImpresion(di, e.gerente, e.sucursal, pedido);
      const segundo = await pedirLaImpresion(di, e.gerente, e.sucursal, pedido);
      expect(primero).toMatchObject({
        ok: true,
        dato: { trabajoId: envio.dato.trabajoId, estado: "PENDIENTE", yaExistia: true },
      });
      expect(segundo).toMatchObject({ ok: true, dato: { yaExistia: true } });
      expect(await cuantos("trabajo_de_impresion", "documento_id", documentoId)).toBe(1);
      const declarar = (resultado: string, contexto = e.gerente) =>
        declararElResultadoDeImpresion(di, contexto, e.sucursal, {
          trabajoId: envio.dato.trabajoId,
          numero: 1,
          resultado,
        });
      expect(await declarar("IMPRESA")).toMatchObject({
        ok: true,
        dato: { estado: "IMPRESA", yaExistia: false },
      });
      expect(await declarar("IMPRESA")).toMatchObject({
        ok: true,
        dato: { estado: "IMPRESA", yaExistia: true },
      });
      expect(codigo(await declarar("FALLIDA"))).toBe(GENERICO);
      expect(codigo(await declarar("QUIEN_SABE"))).toBe(GENERICO);
      // La lista del documento trae lo declarado: ni huella ni clave ni quién lo pidió.
      const trabajos = await verLosTrabajosDeImpresion(di, e.operador, e.sucursal, { documentoId });
      expect(trabajos).toMatchObject({ ok: true });
      if (!trabajos.ok) return;
      expect(trabajos.dato.trabajos).toHaveLength(1);
      expect(Object.keys(trabajos.dato.trabajos[0] ?? {}).sort()).toEqual(
        [
          "documentoId",
          "documentoTipo",
          "esCopia",
          "estado",
          "id",
          "impresoraId",
          "intentos",
        ].sort(),
      );
      expect(trabajos.dato.trabajos[0]).toMatchObject({ estado: "IMPRESA" });
      // Desde otra sucursal la lista de trabajos no trae nada.
      const deOtra = await verLosTrabajosDeImpresion(di, e.gerente, e.otraSucursal, {
        documentoId,
      });
      expect(deOtra.ok && deOtra.dato.trabajos).toEqual([]);
    });

    it("«Reimprimir» es un trabajo nuevo con el papel «Copia»; repetir con la misma clave no duplica; el papel no lleva precios", async () => {
      const { cuenta } = await cuentaConPlatos(["AHORA"]);
      const envio = await enviar(cuenta);
      expect(envio.ok).toBe(true);
      if (!envio.ok) return;
      const copia = {
        trabajoId: nuevoId(),
        documentoTipo: "COMANDA",
        documentoId: envio.dato.envioId,
        claveIdempotencia: nuevaClave(),
      };
      const primera = await pedirUnaCopia(di, e.gerente, e.sucursal, copia);
      const segunda = await pedirUnaCopia(di, e.gerente, e.sucursal, copia);
      expect(primera).toMatchObject({ ok: true, dato: { yaExistia: false } });
      expect(segunda).toMatchObject({ ok: true, dato: { yaExistia: true } });
      expect(
        await m.contar(
          "select count(*) as n from trabajo_de_impresion where documento_id = $1 and es_copia",
          [envio.dato.envioId],
        ),
      ).toBe(1);
      const papel = await verElPapelDelDocumento(di, e.gerente, e.sucursal, {
        documentoTipo: "COMANDA",
        documentoId: envio.dato.envioId,
        copia: true,
      });
      expect(papel).toMatchObject({ ok: true });
      expect([58, 80]).toContain(papel.ok ? papel.dato.ancho : 0);
      if (!papel.ok) return;
      const texto = papel.dato.lineas.map((l) => l.texto).join("\n");
      expect(texto).toContain("Copia");
      expect(texto).toContain("COMANDA");
      expect(texto).not.toMatch(/\$|1000|2000/);
      expect(Object.keys(papel.dato.lineas[0] ?? {}).sort()).toEqual(["estilo", "texto"]);
    });

    it("un documento o una impresora que no existen, un tipo inexistente o un pedido mal formado son el genérico", async () => {
      expect(codigo(await imprimir(nuevoId()))).toBe(GENERICO);
      expect(codigo(await imprimir(nuevoId(), { documentoTipo: "OTRO" }))).toBe(GENERICO);
      expect(codigo(await imprimir("no-es-un-id"))).toBe(GENERICO);
      expect(codigo(await imprimir(nuevoId(), { impresoraId: nuevoId() }))).toBe(GENERICO);
      expect(
        codigo(
          await verElPapelDelDocumento(di, e.gerente, e.sucursal, {
            documentoTipo: "COMANDA",
            documentoId: nuevoId(),
          }),
        ),
      ).toBe(GENERICO);
      expect(codigo(await imprimir(nuevoId(), {}, e.gerente))).toBe(GENERICO);
      expect(
        codigo(
          await pedirLaImpresion(di, e.gerente, "", {
            trabajoId: nuevoId(),
            documentoTipo: "COMANDA",
            documentoId: nuevoId(),
            claveIdempotencia: nuevaClave(),
          }),
        ),
      ).toBe(GENERICO);
    });
  });
});
