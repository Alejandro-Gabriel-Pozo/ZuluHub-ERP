import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  enviarALaCocina,
  type DependenciasDeComandasWeb,
} from "../../src/composicion/comandas-web";
import {
  declararElResultadoDeImpresion,
  desactivarLaImpresora,
  pedirLaImpresion,
  registrarLaImpresora,
  verElPapelDelDocumento,
  verLasImpresoras,
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
 * La pantalla «Impresoras» y la pieza de impresión (S-2) contra una base real y los roles reales, con ACCIONES A LA VEZ: dos altas con el mismo id (el doble toque) son una sola impresora; dos pestañas que dan de
 * alta el mismo nombre dejan una sola y la otra recibe el genérico; «Quitar» dos veces a la vez desactiva una vez y audita una; «Imprimir» dos veces a la vez saca UN solo trabajo y «Reintentar» dos veces a la vez suma
 * UN solo intento; el operador ve la lista y no administra; la lista y el papel de otra sucursal no se ven. Lo secuencial ya lo prueba `comandas-web.test.ts`; acá va lo que pasa cuando dos llegan juntos.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";
const codigo = (r: { ok: boolean; error?: { codigo: string } }) =>
  r.ok ? null : (r.error?.codigo ?? null);

describe.skipIf(base === null)("impresoras de la web con acciones a la vez", () => {
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

  /** Repite solo ante el agotamiento de reintentos de la base (la carga de la máquina), nunca ante un error de negocio. */
  const repetir = <R extends { ok: boolean; error?: { codigo?: unknown } }>(
    trabajo: () => Promise<R>,
  ) => repetirSiAgotada(trabajo, { esAgotada: agotadaSegunElRegistro(registrados) });
  const cuantos = (tabla: string, columna: string, valor: string) =>
    m.contar(`select count(*) as n from ${tabla} where ${columna} = $1`, [valor]);
  const alta = (extra: Record<string, unknown> = {}, contexto = e.gerente, sucursal = e.sucursal) =>
    registrarLaImpresora(di, contexto, sucursal, {
      impresoraId: nuevoId(),
      nombre: `Cocina ${++proxima}`,
      uso: "COMANDA",
      papelMm: 80,
      ...extra,
    });

  it("DOBLE TOQUE: dos altas a la vez con el mismo id son UNA impresora y una sola auditoría", async () => {
    const impresoraId = nuevoId();
    const datos = { impresoraId, nombre: `Doble ${++proxima}`, uso: "TICKET", papelMm: 58 };
    const [a, b] = await Promise.all([
      repetir(() => registrarLaImpresora(di, e.gerente, e.sucursal, datos)),
      repetir(() => registrarLaImpresora(di, e.gerente, e.sucursal, datos)),
    ]);
    expect(a).toMatchObject({ ok: true, dato: { impresoraId } });
    expect(b).toMatchObject({ ok: true, dato: { impresoraId } });
    expect([a, b].filter((r) => r.ok && r.dato.yaExistia)).toHaveLength(1);
    expect(await cuantos("impresora", "id", impresoraId)).toBe(1);
    const auditadas = (await m.auditoria(e.empresa, "IMPRESORA_CREADA")).filter(
      (x) => x["entidad_id"] === impresoraId,
    );
    expect(auditadas).toHaveLength(1);
  });

  it("DOS PESTAÑAS: el mismo nombre con ids distintos a la vez deja UNA impresora; la otra recibe el genérico", async () => {
    const nombre = `Pestañas ${++proxima}`;
    const resultados = await Promise.all([
      repetir(() => alta({ nombre })),
      repetir(() => alta({ nombre })),
    ]);
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ok).map(codigo)).toEqual([GENERICO]);
    expect(
      await m.contar("select count(*) as n from impresora where sucursal_id = $1 and nombre = $2", [
        e.sucursal,
        nombre,
      ]),
    ).toBe(1);
  });

  it("«QUITAR» dos veces a la vez: las dos salen bien, queda desactivada (no borrada) y se audita una sola vez", async () => {
    const creada = await alta();
    expect(creada.ok).toBe(true);
    if (!creada.ok) return;
    const impresoraId = creada.dato.impresoraId;
    const resultados = await Promise.all([
      repetir(() => desactivarLaImpresora(di, e.gerente, e.sucursal, { impresoraId })),
      repetir(() => desactivarLaImpresora(di, e.administrador, e.sucursal, { impresoraId })),
    ]);
    expect(resultados.every((r) => r.ok)).toBe(true);
    expect(resultados.filter((r) => r.ok && !r.dato.yaEstabaDesactivada)).toHaveLength(1);
    expect(
      await m.contar("select count(*) as n from impresora where id = $1 and not activa", [
        impresoraId,
      ]),
    ).toBe(1);
    expect(await cuantos("impresora", "id", impresoraId)).toBe(1);
    const auditadas = (await m.auditoria(e.empresa, "IMPRESORA_DESACTIVADA")).filter(
      (x) => x["entidad_id"] === impresoraId,
    );
    expect(auditadas).toHaveLength(1);
  });

  it("PERMISOS: el operador ve la lista y no agrega ni quita; la lista de otra sucursal y de otra empresa no se ve", async () => {
    const creada = await alta();
    expect(creada.ok).toBe(true);
    if (!creada.ok) return;
    const lista = await verLasImpresoras(di, e.operador, e.sucursal);
    expect(lista.ok && lista.dato.impresoras.some((i) => i.id === creada.dato.impresoraId)).toBe(
      true,
    );
    const antes = await m.contar("select count(*) as n from impresora where sucursal_id = $1", [
      e.sucursal,
    ]);
    expect((await alta({}, e.operador)).ok).toBe(false);
    expect(
      (
        await desactivarLaImpresora(di, e.operador, e.sucursal, {
          impresoraId: creada.dato.impresoraId,
        })
      ).ok,
    ).toBe(false);
    expect(
      await m.contar("select count(*) as n from impresora where sucursal_id = $1", [e.sucursal]),
    ).toBe(antes);
    // Otra sucursal de la misma empresa: no trae la impresora de ésta.
    const deOtra = await verLasImpresoras(di, e.gerente, e.otraSucursal);
    expect(deOtra.ok && deOtra.dato.impresoras.some((i) => i.id === creada.dato.impresoraId)).toBe(
      false,
    );
    // Otra empresa: ni ve ni toca.
    const ajeno = await m.escenario();
    const deAjena = await verLasImpresoras(di, ajeno.gerente, ajeno.sucursal);
    expect(
      deAjena.ok && deAjena.dato.impresoras.some((i) => i.id === creada.dato.impresoraId),
    ).toBe(false);
    expect(
      codigo(
        await desactivarLaImpresora(di, ajeno.gerente, ajeno.sucursal, {
          impresoraId: creada.dato.impresoraId,
        }),
      ),
    ).toBe(GENERICO);
  });

  describe("imprimir y reintentar con dos toques a la vez", () => {
    /** Un envío a cocina real (con su comanda y su trabajo) para tener un documento que imprimir. */
    const unEnvio = async () => {
      expect(await alta()).toMatchObject({ ok: true });
      const n = 900 + ++proxima;
      const mesaId = nuevoId();
      valorDe(
        await m.salon.crearMesa(e.gerente, {
          mesaId,
          sucursalId: e.sucursal,
          numero: n % 99 === 0 ? 98 : n % 99,
          forma: "CUADRADA",
          tamano: "CHICA",
          columna: 1 + (proxima % 7) * 2,
          fila: 1 + Math.floor(proxima / 7) * 2,
        }),
      );
      const cuentaId = valorDe(
        await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId }),
      ).cuentaId;
      valorDe(
        await m.salon.agregarAlPedido(e.gerente, {
          cuentaId,
          lineaId: nuevoId(),
          productoId: e.producto,
          opcionIds: [],
          cantidad: "1",
          salida: "AHORA",
        }),
      );
      const envio = await enviarALaCocina(d, e.gerente, e.sucursal, {
        envioId: nuevoId(),
        cuentaId,
        claveIdempotencia: nuevaClave(),
      });
      expect(envio).toMatchObject({ ok: true });
      if (!envio.ok) throw new Error("el envío no salió");
      return envio.dato;
    };

    it("«Imprimir» dos veces a la vez (claves distintas) es UN solo trabajo y el papel lo entrega el servidor", async () => {
      const envio = await unEnvio();
      const pedir = () =>
        repetir(() =>
          pedirLaImpresion(di, e.gerente, e.sucursal, {
            trabajoId: envio.trabajoId,
            documentoTipo: "COMANDA",
            documentoId: envio.envioId,
            claveIdempotencia: nuevaClave(),
          }),
        );
      const [a, b] = await Promise.all([pedir(), pedir()]);
      expect(a).toMatchObject({ ok: true, dato: { trabajoId: envio.trabajoId } });
      expect(b).toMatchObject({ ok: true, dato: { trabajoId: envio.trabajoId } });
      expect(await cuantos("trabajo_de_impresion", "documento_id", envio.envioId)).toBe(1);
      const papel = await verElPapelDelDocumento(di, e.operador, e.sucursal, {
        documentoTipo: "COMANDA",
        documentoId: envio.envioId,
      });
      expect(papel).toMatchObject({ ok: true, dato: { ancho: 80 } });
      expect(papel.ok && papel.dato.lineas.length).toBeGreaterThan(0);
    });

    it("«Reintentar» dos veces a la vez: el MISMO trabajo con UN solo intento más, y declarar lo mismo dos veces es lo mismo", async () => {
      const envio = await unEnvio();
      const documento = {
        trabajoId: envio.trabajoId,
        documentoTipo: "COMANDA",
        documentoId: envio.envioId,
      };
      expect(
        await pedirLaImpresion(di, e.gerente, e.sucursal, {
          ...documento,
          claveIdempotencia: nuevaClave(),
        }),
      ).toMatchObject({ ok: true, dato: { yaExistia: true } });
      const declarar = (numero: number, resultado: string) =>
        repetir(() =>
          declararElResultadoDeImpresion(di, e.gerente, e.sucursal, {
            trabajoId: envio.trabajoId,
            numero,
            resultado,
          }),
        );
      const [d1, d2] = await Promise.all([declarar(1, "FALLIDA"), declarar(1, "FALLIDA")]);
      expect(d1).toMatchObject({ ok: true, dato: { estado: "FALLIDA", intentos: 1 } });
      expect(d2).toMatchObject({ ok: true, dato: { estado: "FALLIDA", intentos: 1 } });
      expect([d1, d2].filter((r) => r.ok && r.dato.yaExistia)).toHaveLength(1);
      const reintentar = () =>
        repetir(() =>
          pedirLaImpresion(di, e.gerente, e.sucursal, {
            ...documento,
            claveIdempotencia: nuevaClave(),
          }),
        );
      const [r1, r2] = await Promise.all([reintentar(), reintentar()]);
      expect(r1.ok && r2.ok).toBe(true);
      expect([r1, r2].filter((r) => r.ok && r.dato.reintento)).toHaveLength(1);
      expect(
        await m.contar("select intentos as n from trabajo_de_impresion where documento_id = $1", [
          envio.envioId,
        ]),
      ).toBe(2);
      expect(await cuantos("trabajo_de_impresion", "documento_id", envio.envioId)).toBe(1);
      // El intento 2 se declara una vez y deja el trabajo impreso; declarar otra cosa para el mismo intento es el genérico.
      expect(await declarar(2, "IMPRESA")).toMatchObject({
        ok: true,
        dato: { estado: "IMPRESA", intentos: 2 },
      });
      expect(codigo(await declarar(2, "FALLIDA"))).toBe(GENERICO);
    });
  });
});
