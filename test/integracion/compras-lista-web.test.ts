import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  fichaDeLaCompra,
  listarLasCompras,
  type DependenciasDeComprasListaWeb,
} from "../../src/composicion/compras-lista-web";
import type { TxDeConsultasDeCompras } from "../../src/modulos/compras/casos-de-uso/contrato";
import { crearConsultasDeCompras } from "../../src/modulos/compras/publico";
import { crearDirectorioDePartes } from "../../src/modulos/clientes/publico";
import { crearConsultasDeIdentidad } from "../../src/modulos/identidad/publico";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * Compras PR 3: la lista y la ficha de una compra para la pantalla, con una base real. Son LECTURAS: no hay escritura que repetir ni doble envío, así que no hay prueba de idempotencia
 * (repetir una lectura da lo mismo, y se prueba que da lo mismo). Se prueba: el aislamiento por empresa y por sucursal, el total (null sin precio, con la última corrección, igual a la suma de la ficha),
 * los nombres (también de lo desactivado), el orden y el cursor por número (sin repetir ni saltear, aunque se cargue una compra mientras se pagina), que las lecturas por lote no crecen con la
 * cantidad de compras, los permisos y que sin poder ver personas la ficha sale igual.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
const GENERICO = { ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } };
/** El genérico con todo lo que lo acompaña (clave del texto y presentación): solo importa que sea ESE código. */
const esGenerico = (r: unknown) => expect(r).toMatchObject(GENERICO);

describe.skipIf(base === null)("composición web: lista y ficha de compras", () => {
  let c: MundoDeCompras;
  let e: EscenarioDeCompras;
  let d: DependenciasDeComprasListaWeb;
  const registrados: string[] = [];
  type MundoDeCompras = MontajeDeCompras;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    e = await c.escenario();
    const identidad = crearConsultasDeIdentidad({
      transacciones: c.entorno,
      reglas: REGLAS_DE_EMPRESA,
    });
    d = {
      consultas: () => c.consultas,
      consultasDeIdentidad: () => identidad,
      respuesta: { registrar: (x) => registrados.push(x) },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const armar = async (escenario = e, sucursal = escenario.sucursal) => ({
    deposito: await c.deposito({ empresa: escenario.empresa, sucursal }),
    producto: await c.producto(escenario.empresa, { unidadBase: "GRAMO", dimension: "MASA" }),
    proveedor: await c.proveedor(escenario.operador),
    sucursal,
  });
  type Montaje = Awaited<ReturnType<typeof armar>>;
  /** 2 kg a 1000 el kilo: importe 2000.00. */
  const compra = (m: Montaje, renglon: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    sucursalId: m.sucursal,
    proveedorId: m.proveedor,
    depositoId: m.deposito,
    renglones: [
      {
        productoId: m.producto,
        unidadDeCompraId: "KILOGRAMO",
        cantidad: "2",
        precioPor: "UNIDAD",
        unidadDePrecioId: "KILOGRAMO",
        precio: "1000",
        ...renglon,
      },
    ],
  });
  const comprar = async (m: Montaje, quien = e.operador, renglon: Record<string, unknown> = {}) =>
    valorDe(await c.casos.registrarCompra(quien, compra(m, renglon)));
  const lista = async (quien = e.operador, sucursal = e.sucursal, crudo: unknown = {}) => {
    const r = await listarLasCompras(d, quien, sucursal, crudo);
    if (!r.ok) throw new Error(`la lista tenía que salir: ${JSON.stringify(r.error)}`);
    return r.dato;
  };
  const ficha = async (quien: typeof e.operador, id: string) => {
    const r = await fichaDeLaCompra(d, quien, id);
    if (!r.ok) throw new Error(`la ficha tenía que salir: ${JSON.stringify(r.error)}`);
    return r.dato;
  };

  it("la lista sale campo por campo con el nombre del proveedor y el total en pesos; sin ids internos de más", async () => {
    const empresa = await c.escenario();
    const m = await armar(empresa);
    const r1 = valorDe(await c.casos.registrarCompra(empresa.operador, compra(m)));
    const pagina = await lista(empresa.operador, empresa.sucursal);
    expect(pagina.compras).toHaveLength(1);
    const fila = pagina.compras[0];
    expect(Object.keys(fila ?? {}).sort()).toEqual(
      ["estado", "factura", "fechaNegocio", "numero", "proveedor", "recepcionId", "total"].sort(),
    );
    expect(fila).toMatchObject({
      recepcionId: r1.recepcionId,
      numero: 1,
      estado: "RECIBIDA_SIN_FACTURAR",
      total: { moneda: "ARS", monto: "2000.00" },
      factura: null,
    });
    expect(typeof fila?.proveedor).toBe("string");
    expect(pagina.siguiente).toBeNull();
  });

  it("una compra con una línea «Sin precio» tiene total null, nunca cero", async () => {
    const empresa = await c.escenario();
    const m = await armar(empresa);
    const r = valorDe(
      await c.casos.registrarCompra(
        empresa.operador,
        compra(m, { precio: null, unidadDePrecioId: null }),
      ),
    );
    const pagina = await lista(empresa.operador, empresa.sucursal);
    expect(pagina.compras[0]?.total).toBeNull();
    const f = await ficha(empresa.operador, r.recepcionId);
    expect(f.total).toBeNull();
    expect(f.lineas[0]?.importe).toBeNull();
    expect(f.lineas[0]?.costoPorUnidadDeStock).toBeNull();
  });

  it("el total usa la última corrección de precio, la línea original queda intacta y el total de la lista es la suma de la ficha", async () => {
    const empresa = await c.escenario();
    const m = await armar(empresa);
    const segundo = {
      productoId: m.producto,
      unidadDeCompraId: "KILOGRAMO",
      cantidad: "3",
      precioPor: "UNIDAD",
      unidadDePrecioId: "KILOGRAMO",
      precio: "500",
    };
    const dos = { ...compra(m), renglones: [...compra(m).renglones, segundo] };
    const r = valorDe(await c.casos.registrarCompra(empresa.operador, dos));
    // 2 × 1000 + 3 × 500 = 3500.00
    expect((await lista(empresa.operador, empresa.sucursal)).compras[0]?.total?.monto).toBe(
      "3500.00",
    );
    valorDe(
      await c.casos.corregirCompra(empresa.gerente, {
        clave: nuevoId(),
        recepcionId: r.recepcionId,
        linea: 1,
        correccionesVistas: 0,
        precio: "1200",
        motivo: "El proveedor cobró 1200 el kilo",
      }),
    );
    valorDe(
      await c.casos.corregirCompra(empresa.gerente, {
        clave: nuevoId(),
        recepcionId: r.recepcionId,
        linea: 1,
        correccionesVistas: 1,
        precio: "1300",
        motivo: "Era 1300 el kilo",
      }),
    );
    // La última gana: 2 × 1300 + 3 × 500 = 4100.00
    const pagina = await lista(empresa.operador, empresa.sucursal);
    expect(pagina.compras[0]?.total?.monto).toBe("4100.00");
    const f = await ficha(empresa.operador, r.recepcionId);
    expect(f.lineas.map((l) => l.importe?.monto)).toEqual(["2600.00", "1500.00"]);
    expect(f.total?.monto).toBe("4100.00");
    // La línea original no se tocó (la corrección es una fila aparte).
    const guardada = await c.filas<{ importe: string }>(
      "select importe::text as importe from linea_de_recepcion where recepcion_id = $1 order by numero",
      [r.recepcionId],
    );
    expect(guardada.map((g) => g.importe)).toEqual(["2000.00", "1500.00"]);
    // El costo de una línea corregida no se muestra con el valor viejo.
    expect(f.lineas[0]?.costoPorUnidadDeStock).toBeNull();
    expect(f.lineas[1]?.costoPorUnidadDeStock).not.toBeNull();
    expect(
      f.lineas.reduce((suma, l) => suma + Number((l.importe?.monto ?? "0").replace(".", "")), 0),
    ).toBe(Number((pagina.compras[0]?.total?.monto ?? "0").replace(".", "")));
  });

  it("la ficha trae las líneas con nombre, lo que entra al stock y su unidad, el remito y el correo de quien cargó (no su id)", async () => {
    const empresa = await c.escenario();
    const m = await armar(empresa);
    const r = await comprar(m, empresa.operador);
    const correo = (
      await c.filas<{ email: string }>("select email from persona where id = $1", [
        empresa.operador.personaId,
      ])
    )[0]?.email;
    const f = await ficha(empresa.operador, r.recepcionId);
    expect(f).toMatchObject({
      recepcionId: r.recepcionId,
      estado: "RECIBIDA_SIN_FACTURAR",
      remito: null,
      registradaPor: correo,
      anulacion: null,
      factura: null,
      total: { moneda: "ARS", monto: "2000.00" },
    });
    expect(f.lineas[0]).toMatchObject({
      numero: 1,
      cantidadEnStock: "2000.0000",
      unidadDeStockId: "GRAMO",
      unidadDeCompraId: "KILOGRAMO",
      presentacion: null,
      importe: { moneda: "ARS", monto: "2000.00" },
    });
    expect(typeof f.lineas[0]?.producto).toBe("string");
    expect(JSON.stringify(f)).not.toContain(empresa.operador.personaId as string);
  });

  it("una compra anulada sale con su motivo, quién y cuándo, y no entra en «Sin facturar»", async () => {
    const empresa = await c.escenario();
    const m = await armar(empresa);
    const r = await comprar(m, empresa.operador);
    valorDe(
      await c.casos.anularCompra(empresa.gerente, {
        recepcionId: r.recepcionId,
        motivo: "Se cargó por error",
      }),
    );
    const f = await ficha(empresa.operador, r.recepcionId);
    expect(f.estado).toBe("ANULADA");
    expect(f.anulacion).toMatchObject({ motivo: "Se cargó por error" });
    expect(typeof f.anulacion?.hechaPor).toBe("string");
    const todas = await lista(empresa.operador, empresa.sucursal, { estado: "TODAS" });
    expect(todas.compras.map((x) => x.estado)).toEqual(["ANULADA"]);
    const sinFacturar = await lista(empresa.operador, empresa.sucursal, {
      estado: "SIN_FACTURAR",
    });
    expect(sinFacturar.compras).toHaveLength(0);
  });

  it("aislamiento: la lista de una empresa no trae filas de otra, y pedir por el id de otra empresa da el genérico (igual que uno inexistente)", async () => {
    const a = await c.escenario();
    const b = await c.escenario();
    const ma = await armar(a);
    const mb = await armar(b);
    const ra = await comprar(ma, a.operador);
    const rb = await comprar(mb, b.operador);
    const deA = await lista(a.operador, a.sucursal);
    expect(deA.compras.map((x) => x.recepcionId)).toEqual([ra.recepcionId]);
    esGenerico(await fichaDeLaCompra(d, a.operador, rb.recepcionId));
    esGenerico(await fichaDeLaCompra(d, a.operador, nuevoId()));
    // Pedir la sucursal de otra empresa tampoco la muestra: sin alcance, el genérico.
    esGenerico(await listarLasCompras(d, a.operador, b.sucursal, {}));
    // El nombre de un proveedor de otra empresa no se resuelve desde esta.
    const nombres = await c.entorno.ejecutar(
      { contexto: a.operador, aislamiento: "read committed", soloLectura: true },
      async (tx) => ({
        ok: true as const,
        valor: await crearDirectorioDePartes().nombresParaMostrar(tx, a.empresaId, [mb.proveedor]),
      }),
    );
    if (!nombres.ok) throw new Error("la lectura tenía que salir");
    expect(nombres.valor.get(mb.proveedor)).toBeNull();
  });

  it("sucursal: quien tiene alcance a una sola no ve las compras de otra, ni pidiendo la sucursal ni abriendo la ficha", async () => {
    const empresa = await c.escenario();
    const propia = await armar(empresa);
    const ajena = await armar(empresa, empresa.otraSucursal);
    const mia = await comprar(propia, empresa.operador);
    const deLaOtra = valorDe(await c.casos.registrarCompra(empresa.gerente, compra(ajena)));
    expect(
      (await lista(empresa.operador, empresa.sucursal)).compras.map((x) => x.recepcionId),
    ).toEqual([mia.recepcionId]);
    esGenerico(await listarLasCompras(d, empresa.operador, empresa.otraSucursal, {}));
    esGenerico(await fichaDeLaCompra(d, empresa.operador, deLaOtra.recepcionId));
    // El gerente (alcance a todas) sí ve la de la otra sucursal.
    expect(
      (await lista(empresa.gerente, empresa.otraSucursal)).compras.map((x) => x.recepcionId),
    ).toEqual([deLaOtra.recepcionId]);
  });

  it("nombres: un proveedor desactivado y un producto desactivado se muestran igual; uno anonimizado sale null", async () => {
    const empresa = await c.escenario();
    const m = await armar(empresa);
    const anonimo = await c.proveedor(empresa.operador);
    const r = await comprar(m, empresa.operador);
    const r2 = valorDe(
      await c.casos.registrarCompra(empresa.operador, {
        ...compra(m),
        proveedorId: anonimo,
      }),
    );
    const nombreAntes = (await ficha(empresa.operador, r.recepcionId)).proveedor;
    const productoAntes = (await ficha(empresa.operador, r.recepcionId)).lineas[0]?.producto;
    valorDe(await c.clientes.desactivarParte(empresa.gerente, { parteId: m.proveedor }));
    await c.filas("update producto set activo = false where id = $1", [m.producto]);
    const f = await ficha(empresa.operador, r.recepcionId);
    expect(f.proveedor).toBe(nombreAntes);
    expect(f.lineas[0]?.producto).toBe(productoAntes);
    const fila = (await lista(empresa.operador, empresa.sucursal)).compras.find(
      (x) => x.recepcionId === r.recepcionId,
    );
    expect(fila?.proveedor).toBe(nombreAntes);
    // Anonimizada: sin caso de uso todavía (S-3); la base la deja con el nombre nulo.
    await c.filas("update parte_rol set activo = false where parte_id = $1", [anonimo]);
    await c.filas(
      "update parte set estado = 'ANONIMIZADA', nombre = null, apellido = null, alias = null where id = $1",
      [anonimo],
    );
    const anonimizada = (await lista(empresa.operador, empresa.sucursal)).compras.find(
      (x) => x.recepcionId === r2.recepcionId,
    );
    expect(anonimizada?.proveedor).toBeNull();
    expect((await ficha(empresa.operador, r2.recepcionId)).proveedor).toBeNull();
  });

  describe("orden y cursor por número", () => {
    it("el cursor por número con páginas de 2: la más nueva primero, sin repetir ni saltear, y aunque se cargue una compra mientras se pagina", async () => {
      // Pocas filas y páginas chicas (el límite lo recibe el repositorio): prueban lo mismo que 120 compras sin el volumen ni 8 escritores a la vez.
      const empresa = await c.escenario();
      const m = await armar(empresa);
      const registrar = async () =>
        valorDe(await c.casos.registrarCompra(empresa.operador, compra(m)));
      for (let i = 0; i < 5; i++) await registrar();
      const pagina = async (despuesDe: { fechaNegocio: string; numero: number } | null) => {
        const r = await c.entorno.ejecutar(
          { contexto: empresa.operador, aislamiento: "read committed", soloLectura: true },
          async (tx: TxDeConsultasDeCompras) => ({
            ok: true as const,
            valor: await tx.lecturasDeCompras.listar(empresa.empresaId, {
              sucursales: "TODAS",
              proveedorId: null,
              estado: null,
              facturada: null,
              desde: null,
              hasta: null,
              despuesDe,
              limite: 3,
            }),
          }),
        );
        if (!r.ok) throw new Error("la lectura tenía que salir");
        return r.valor;
      };
      const cursorDe = (filas: Awaited<ReturnType<typeof pagina>>) => {
        const ultima = filas.slice(0, 2).at(-1);
        return ultima === undefined
          ? null
          : { fechaNegocio: ultima.fechaNegocio, numero: ultima.numero };
      };
      const primera = await pagina(null);
      expect(primera).toHaveLength(3);
      expect(primera.slice(0, 2).map((x) => x.numero)).toEqual([5, 4]);
      // Mientras se pide la segunda página se carga una compra nueva (dos actores a la vez).
      const [segunda] = await Promise.all([pagina(cursorDe(primera)), registrar()]);
      expect(segunda.slice(0, 2).map((x) => x.numero)).toEqual([3, 2]);
      expect(segunda).toHaveLength(3);
      const tercera = await pagina(cursorDe(segunda));
      expect(tercera.map((x) => x.numero)).toEqual([1]);
      // Ninguna se repite ni se saltea: las 5 que había; la 6 es nueva y quedó arriba.
      const vistos = [...primera.slice(0, 2), ...segunda.slice(0, 2), ...tercera].map(
        (x) => x.numero,
      );
      expect([...vistos].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
      expect((await pagina(null))[0]?.numero).toBe(6);
      // Repetir la lectura da lo mismo.
      expect(await pagina(cursorDe(primera))).toEqual(await pagina(cursorDe(primera)));
    });

    it("un cursor mal formado es el genérico", async () => {
      for (const malo of ["x", "2026-11-20|abc", `2026-11-20|${nuevoId()}`]) {
        esGenerico(await listarLasCompras(d, e.operador, e.sucursal, { despues: malo }));
      }
    });
  });

  it("sin N+1: las lecturas a los repositorios por página no crecen con la cantidad de compras", async () => {
    const empresa = await c.escenario();
    const m = await armar(empresa);
    const llamadas = { n: 0 };
    const contar = <T extends object>(objeto: T): T =>
      new Proxy(objeto, {
        get(destino, clave, receptor) {
          const valor = Reflect.get(destino, clave, receptor) as unknown;
          if (typeof valor === "function") {
            return (...argumentos: unknown[]) => {
              llamadas.n++;
              return (valor as (...a: unknown[]) => unknown).apply(destino, argumentos);
            };
          }
          return valor;
        },
      });
    const alContar = (tx: object): object =>
      new Proxy(tx, {
        get(destino, clave, receptor) {
          const valor = Reflect.get(destino, clave, receptor) as unknown;
          return typeof valor === "object" && valor !== null && clave !== "db"
            ? contar(valor)
            : valor;
        },
      });
    const transacciones = {
      ejecutar: (opciones: never, trabajo: (tx: never) => unknown) =>
        c.entorno.ejecutar(opciones, (tx) => trabajo(alContar(tx) as never) as never),
    } as unknown as Parameters<typeof crearConsultasDeCompras>[0]["transacciones"];
    const contadas = crearConsultasDeCompras({
      transacciones,
      reglas: c.reglas,
    });
    const cuantas = async () => {
      llamadas.n = 0;
      valorDe(await contadas.listarCompras(empresa.operador, { sucursalId: empresa.sucursal }));
      return llamadas.n;
    };
    for (let i = 0; i < 4; i++) {
      const r = await comprar(m, empresa.operador);
      if (i === 0) {
        valorDe(
          await c.casos.corregirCompra(empresa.gerente, {
            clave: nuevoId(),
            recepcionId: r.recepcionId,
            linea: 1,
            correccionesVistas: 0,
            precio: "1100",
            motivo: "Ajuste",
          }),
        );
      }
    }
    const conCuatro = await cuantas();
    for (let lote = 0; lote < 4; lote++) {
      await Promise.all(
        Array.from({ length: 8 }, () => c.casos.registrarCompra(empresa.operador, compra(m))),
      );
    }
    const conTreintaYSeis = await cuantas();
    expect(conCuatro).toBeGreaterThan(0);
    expect(conTreintaYSeis).toBe(conCuatro);
  });

  it("permisos: con el módulo apagado se rechaza; el operador ve la lista y la ficha con el correo de quien cargó", async () => {
    const empresa = await c.escenario();
    const m = await armar(empresa);
    const r = await comprar(m, empresa.operador);
    // Los tres roles ven la lista y la ficha.
    for (const quien of [empresa.operador, empresa.gerente, empresa.administrador]) {
      expect((await lista(quien, empresa.sucursal)).compras).toHaveLength(1);
      expect((await ficha(quien, r.recepcionId)).registradaPor).not.toBeNull();
    }
    c.apagarModulo("compras");
    try {
      const rechazada = await listarLasCompras(d, empresa.operador, empresa.sucursal, {});
      expect(rechazada.ok).toBe(false);
      expect((await fichaDeLaCompra(d, empresa.operador, r.recepcionId)).ok).toBe(false);
    } finally {
      c.encenderModulo("compras");
    }
  });

  it("personas: sin permiso para ver personas la ficha sale con el correo en null; otro fallo no se esconde", async () => {
    const empresa = await c.escenario();
    const m = await armar(empresa);
    const r = await comprar(m, empresa.operador);
    const sinPermiso: DependenciasDeComprasListaWeb = {
      ...d,
      consultasDeIdentidad: () => ({
        personasParaMostrar: () => Promise.resolve({ ok: false, error: "SIN_PERMISO" }),
      }),
    };
    const salio = await fichaDeLaCompra(sinPermiso, empresa.operador, r.recepcionId);
    if (!salio.ok) throw new Error("la ficha tenía que salir");
    expect(salio.dato.registradaPor).toBeNull();
    expect(salio.dato.lineas).toHaveLength(1);
    const conFallo: DependenciasDeComprasListaWeb = {
      ...d,
      consultasDeIdentidad: () => ({
        personasParaMostrar: () => Promise.resolve({ ok: false, error: "ENTRADA_INVALIDA" }),
      }),
    };
    expect((await fichaDeLaCompra(conFallo, empresa.operador, r.recepcionId)).ok).toBe(false);
  });

  it("el filtro «Sin facturar» y las fechas se aplican; un estado fuera de la lista vuelve a «Todas»", async () => {
    const empresa = await c.escenario();
    const m = await armar(empresa);
    await comprar(m, empresa.operador);
    const hoy = (await lista(empresa.operador, empresa.sucursal)).compras[0]
      ?.fechaNegocio as string;
    expect(
      (await lista(empresa.operador, empresa.sucursal, { estado: "SIN_FACTURAR" })).compras,
    ).toHaveLength(1);
    expect(
      (await lista(empresa.operador, empresa.sucursal, { estado: "cualquiera" })).compras,
    ).toHaveLength(1);
    expect(
      (await lista(empresa.operador, empresa.sucursal, { desde: hoy, hasta: hoy })).compras,
    ).toHaveLength(1);
    expect(
      (
        await lista(empresa.operador, empresa.sucursal, {
          desde: "2000-01-01",
          hasta: "2000-01-02",
        })
      ).compras,
    ).toHaveLength(0);
    // Una clave que el pedido no puede mandar (la sucursal) no cambia lo que se ve.
    const otra = await lista(empresa.operador, empresa.sucursal, {
      sucursalId: empresa.otraSucursal,
    });
    expect(otra.compras).toHaveLength(1);
  });
});
