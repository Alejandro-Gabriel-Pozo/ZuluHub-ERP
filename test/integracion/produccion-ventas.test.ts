import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { guardarLaReceta, type DependenciasDeRecetasWeb } from "../../src/composicion/recetas-web";
import { crearConsultasDeIdentidad } from "../../src/modulos/identidad/publico";
import {
  crearCasosDeUsoDeStock,
  crearConsultasDeStock,
  type CasosDeUsoDeStock,
  type TxDeStock,
} from "../../src/modulos/stock/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { productoDeBase } from "./catalogo-apoyo";
import type { TxDePrueba } from "./entorno";
import { RONDAS, firme } from "./stock-casos-apoyo";
import { articuloDeBase, depositoDeBase, existenciaDe } from "./stock-apoyo";
import {
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * PRO-V: las pruebas T-1 a T-8 del plan de producción del día uno (§2.3) de punta a punta con la base real y los roles reales: las recetas se cargan por la composición de la web (`guardarLaReceta`, REC-B), se vende
 * por el mostrador (`venderYCobrar`) o por la cuenta, y la producción (`abrirOrden`, `cerrarOrden`) corre sobre la MISMA base y la misma conexión que ventas y stock, como en la aplicación real. Solo pruebas: ningún
 * defecto se corrige acá; si una prueba lo revela, se anota con el caso que falla.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 900_000 });

const monto = (valor: string) => ({ moneda: "ARS", monto: valor });

describe.skipIf(base === null)("producción y ventas sobre la misma base (PRO-V, T-1 a T-8)", () => {
  let m: MundoDeVentas;
  let stock: CasosDeUsoDeStock;
  let recetas: DependenciasDeRecetasWeb;
  /** Mientras no es `null`, la auditoría de esa acción falla (una falla en el MEDIO de una operación, después de que stock escribió). */
  let fallaAlAuditar: string | null = null;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, {
      stock: true,
      produccion: true,
      conexiones: 16,
      ajustarTx: (tx: TxDePrueba): TxDePrueba => ({
        ...tx,
        derechos: {
          ...tx.derechos,
          deLaEmpresa: async (contexto) => {
            const reales = await tx.derechos.deLaEmpresa(contexto);
            return {
              ...reales,
              perillas: new Map(
                [...reales.perillas].map(([perilla, valor]) => [
                  perilla,
                  // Producción y las recetas de dos niveles (un elaborado como ingrediente) son perillas del plan: acá van encendidas.
                  (perilla === "produccion" || perilla === "subcomposiciones") &&
                  valor.tipo === "INTERRUPTOR"
                    ? { ...valor, encendida: true }
                    : valor,
                ]),
              ),
            };
          },
        },
        auditoria: {
          ...tx.auditoria,
          registrar: async (evento) => {
            if (fallaAlAuditar !== null && evento.accion === fallaAlAuditar) {
              throw new Error("falla inyectada en medio de la operación");
            }
            return tx.auditoria.registrar(evento);
          },
        },
      }),
    });
    const transacciones = m.entorno as unknown as Transacciones<TxDeStock>;
    stock = crearCasosDeUsoDeStock({ transacciones, reglas: m.reglas });
    recetas = {
      casosDeUso: () => stock,
      consultas: () => crearConsultasDeStock({ transacciones, reglas: m.reglas }),
      personas: () => crearConsultasDeIdentidad({ transacciones: m.entorno, reglas: m.reglas }),
      respuesta: { registrar: () => undefined },
    };
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  // ---- el escenario ---------------------------------------------------------------------------------------------------------------

  type Mundo = Readonly<{ e: EscenarioDeVentas; dep: string }>;
  /** Una empresa con su sucursal y su depósito de venta. */
  const mundoNuevo = async (): Promise<Mundo> => {
    const e = await m.escenario();
    const dep = await depositoDeBase(m.dueno, e, { deVenta: true });
    return { e, dep };
  };
  const kilos = { unidadBase: "KILOGRAMO", dimension: "MASA" } as const;
  const litros = { unidadBase: "LITRO", dimension: "VOLUMEN" } as const;
  /** Un insumo con su artículo y esa existencia en el depósito de venta. */
  const insumo = async (
    { e, dep }: Mundo,
    existencia: string,
    unidad: Readonly<{ unidadBase: string; dimension: string }> = kilos,
  ) => {
    const a = await articuloDeBase(m.dueno, e, { clase: "MATERIA_PRIMA", ...unidad });
    if (existencia !== "0") {
      valorDe(
        await stock.registrarEntrada(e.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [
            { productoId: a.producto, cantidad: existencia, unidadId: unidad.unidadBase },
          ],
        }),
      );
    }
    return a;
  };
  /** Un producto con precio de la empresa (vendible) o sin él (un elaborado que no se vende). */
  const producto = async (
    e: EscenarioDeVentas,
    clase: "VENDIBLE" | "ELABORADO",
    precio: string | null,
    unidad: Readonly<{ unidadBase: string; dimension: string }> = {
      unidadBase: "UNIDAD",
      dimension: "CONTEO",
    },
  ) => {
    const id = await productoDeBase(m.dueno, e.empresa, { clase, ...unidad });
    if (precio !== null) {
      await m.precio({ empresa: e.empresa, producto: id, precio, desde: "2026-01-01T00:00:00Z" });
    }
    return id;
  };
  type Linea = Readonly<{ ingrediente: string; bruto: string; unidad: string }>;
  /** La receta cargada POR LA WEB (`guardarLaReceta`, el mismo camino de la pantalla de recetas), versión 1. */
  const receta = async (
    e: EscenarioDeVentas,
    productoId: string,
    rinde: string,
    lineas: readonly Linea[],
  ) => {
    const r = await guardarLaReceta(recetas, e.gerente, {
      productoId,
      versionEsperada: 0,
      rinde,
      pasos: "",
      lineas: lineas.map((l) => ({ ingredienteId: l.ingrediente, bruto: l.bruto, merma: "" })),
      unidades: Object.fromEntries(lineas.map((l) => [l.ingrediente, l.unidad])),
    });
    if (!r.ok) throw new Error(`la receta no se guardó: ${JSON.stringify(r.error)}`);
    return r.dato;
  };
  const existencia = (dep: string, articulo: string) => existenciaDe(m.dueno, dep, articulo);

  /** El pedido del mostrador: una línea, el total que espera la persona y el cobro en efectivo. */
  const pedidoDeMostrador = (
    e: EscenarioDeVentas,
    caja: Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>,
    productoId: string,
    cantidad: string,
    total: string,
    sucursal = e.sucursal,
  ) => ({
    claveIdempotencia: nuevaClave(),
    cuentaId: nuevoId(),
    ejemplarId: nuevoId(),
    sucursalId: sucursal,
    lineas: [{ lineaId: nuevoId(), productoId, opcionIds: [], cantidad }],
    totalEsperado: monto(total),
    cobro: {
      cajaId: caja.cajaId,
      cobros: [
        {
          medioDePagoId: caja.medios["EFECTIVO"] as string,
          cuentaDeCobroId: null,
          importe: monto(total),
        },
      ],
    },
  });

  // ---- lo que quedó en la base ----------------------------------------------------------------------------------------------------

  const movimientosDelEjemplar = (ejemplarId: string, clase: "SALIDA" | "ANULACION" = "SALIDA") =>
    m.filas<{ id: string; accion: string }>(
      `select id, accion from movimiento_de_stock where origen_tipo = 'EJEMPLAR_DE_TICKET' and origen_id = $1 and clase = $2 order by registrado_en`,
      [ejemplarId, clase],
    );
  const renglonesDe = (movimientoId: string) =>
    m.filas<{ articulo_id: string; cantidad: string }>(
      "select articulo_id, cantidad::text as cantidad from renglon_de_movimiento where movimiento_id = $1 order by articulo_id",
      [movimientoId],
    );
  const contar = (tabla: string, empresa: string) =>
    m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [empresa]);
  const fijarNivel = (empresa: string, nivel: "PERMITIR" | "AVISAR") =>
    m.dueno.query(
      `insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, null, 'stock.existencia_negativa', $2)
       on conflict on constraint nivel_de_control_uk do update set nivel = excluded.nivel`,
      [empresa, nivel],
    );
  /** El plato de dos niveles del plan: «Salsa» (elaborado SIN stock propio: 0,5 kg de tomate por litro) y «Pasta» (0,2 L de Salsa + 0,1 kg de fideos), con tomate y fideos en el depósito de venta. */
  const pastaDeDosNiveles = async (mundo: Mundo, existencia = "10") => {
    const { e } = mundo;
    const tomate = await insumo(mundo, existencia, kilos);
    const fideos = await insumo(mundo, existencia, kilos);
    const salsa = await producto(e, "ELABORADO", null, litros);
    await receta(e, salsa, "1", [
      { ingrediente: tomate.producto, bruto: "0.5", unidad: "KILOGRAMO" },
    ]);
    const pasta = await producto(e, "VENDIBLE", "1000");
    await receta(e, pasta, "1", [
      { ingrediente: salsa, bruto: "0.2", unidad: "LITRO" },
      { ingrediente: fideos.producto, bruto: "0.1", unidad: "KILOGRAMO" },
    ]);
    return { tomate, fideos, salsa, pasta };
  };

  // ---- T-1 ------------------------------------------------------------------------------------------------------------------------

  it("T-1: receta de dos niveles cargada por la web: vender 3 Pastas baja el tomate 0,3 kg y los fideos 0,3 kg en UN movimiento de venta, ninguno a nombre de la Salsa; ticket y cobro juntos", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const tomate = await insumo(mundo, "10", kilos);
    const fideos = await insumo(mundo, "10", kilos);
    // «Salsa»: un elaborado SIN stock propio (sin artículo), rinde 1 L con 0,5 kg de tomate.
    const salsa = await producto(e, "ELABORADO", null, litros);
    expect(
      await receta(e, salsa, "1", [
        { ingrediente: tomate.producto, bruto: "0.5", unidad: "KILOGRAMO" },
      ]),
    ).toMatchObject({ version: 1, yaExistia: false });
    // «Pasta»: 0,2 L de Salsa + 0,1 kg de fideos por plato.
    const pasta = await producto(e, "VENDIBLE", "1000");
    expect(
      await receta(e, pasta, "1", [
        { ingrediente: salsa, bruto: "0.2", unidad: "LITRO" },
        { ingrediente: fideos.producto, bruto: "0.1", unidad: "KILOGRAMO" },
      ]),
    ).toMatchObject({ version: 1, yaExistia: false });

    const caja = await m.cajaAbierta(e);
    const pedido = pedidoDeMostrador(e, caja, pasta, "3", "3000.00");
    const r = valorDe(await m.casos.venderYCobrar(e.gerente, pedido));
    expect(r).toMatchObject({ estado: "COBRADO", yaExistia: false });
    expect(await existencia(dep, tomate.articulo)).toBe("9.7000");
    expect(await existencia(dep, fideos.articulo)).toBe("9.7000");
    const salidas = await movimientosDelEjemplar(pedido.ejemplarId);
    expect(salidas).toHaveLength(1);
    expect(salidas[0]?.accion).toBe("cuentas.cerrar");
    const renglones = await renglonesDe(salidas[0]?.id as string);
    expect(renglones.map((x) => [x.articulo_id, x.cantidad]).sort()).toEqual(
      [
        [tomate.articulo, "-0.3000"],
        [fideos.articulo, "-0.3000"],
      ].sort(),
    );
    // Ningún movimiento a nombre de la Salsa: no tiene artículo ni libro.
    expect(
      await m.contar(
        "select count(*) as n from articulo_de_stock where empresa_id = $1 and producto_id = $2",
        [e.empresa, salsa],
      ),
    ).toBe(0);
    // Ticket y cobro a la vez: el ticket está emitido y el cobro quedó en la caja.
    expect(await contar("ticket", e.empresa)).toBe(1);
    expect(await contar("cobranza_de_ticket", e.empresa)).toBe(1);
  });

  // ---- T-2 ------------------------------------------------------------------------------------------------------------------------

  it("T-2: la misma venta dos veces y dos clics a la vez, con la receta de dos niveles: una sola salida y la existencia baja una vez", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const { tomate, fideos, pasta } = await pastaDeDosNiveles(mundo, "100");
    const caja = await m.cajaAbierta(e);
    const pedido = pedidoDeMostrador(e, caja, pasta, "3", "3000.00");
    const primera = valorDe(await m.casos.venderYCobrar(e.gerente, pedido));
    expect(primera).toMatchObject({ estado: "COBRADO", yaExistia: false });
    const repetida = valorDe(await m.casos.venderYCobrar(e.gerente, pedido));
    expect(repetida).toMatchObject({ ticketId: primera.ticketId, yaExistia: true });
    expect(await movimientosDelEjemplar(pedido.ejemplarId)).toHaveLength(1);
    expect(await existencia(dep, tomate.articulo)).toBe("99.7000");
    expect(await existencia(dep, fideos.articulo)).toBe("99.7000");

    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const otro = pedidoDeMostrador(e, caja, pasta, "2", "2000.00");
      m.armarBarrera(2);
      try {
        const r = await Promise.all([
          firme(() => m.casos.venderYCobrar(e.gerente, otro)),
          firme(() => m.casos.venderYCobrar(e.gerente, otro)),
        ]);
        expect(r.every((x) => x.ok)).toBe(true);
      } finally {
        m.soltarBarrera();
      }
      expect(await movimientosDelEjemplar(otro.ejemplarId)).toHaveLength(1);
    }
    // 3 platos + 2 por ronda, a 0,1 kg de fideos y 0,1 kg de tomate (0,2 L de Salsa × 0,5 kg/L) por plato.
    const platos = 3 + 2 * RONDAS;
    expect(await existencia(dep, fideos.articulo)).toBe((100 - platos * 0.1).toFixed(4));
    expect(await existencia(dep, tomate.articulo)).toBe((100 - platos * 0.1).toFixed(4));
  });

  // ---- T-4 ------------------------------------------------------------------------------------------------------------------------

  it("T-4: un plato con stock propio y receta, vendido antes de producir (stock en cero): con PERMITIR el stock propio queda en −2 y los ingredientes intactos; con AVISAR la venta frena ENTERA", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const harina = await insumo(mundo, "10", kilos);
    const medialuna = await articuloDeBase(m.dueno, e, { clase: "VENDIBLE", ...kilos });
    await m.precio({
      empresa: e.empresa,
      producto: medialuna.producto,
      precio: "500",
      desde: "2026-01-01T00:00:00Z",
    });
    await receta(e, medialuna.producto, "1", [
      { ingrediente: harina.producto, bruto: "0.1", unidad: "KILOGRAMO" },
    ]);
    // Darle stock propio: el artículo ya existe (stock en cero); la venta descuenta ese artículo y no sus ingredientes.
    const caja = await m.cajaAbierta(e);

    await fijarNivel(e.empresa, "AVISAR");
    const frenada = pedidoDeMostrador(e, caja, medialuna.producto, "2", "1000.00");
    const rechazo = await m.casos.venderYCobrar(e.gerente, frenada);
    expect(rechazo).toMatchObject({ ok: false });
    expect(Number(await existencia(dep, medialuna.articulo))).toBe(0);
    expect(await existencia(dep, harina.articulo)).toBe("10.0000");
    expect(await contar("ticket", e.empresa)).toBe(0);
    expect(await contar("cobranza_de_ticket", e.empresa)).toBe(0);
    expect(await movimientosDelEjemplar(frenada.ejemplarId)).toHaveLength(0);

    await fijarNivel(e.empresa, "PERMITIR");
    const permitida = pedidoDeMostrador(e, caja, medialuna.producto, "2", "1000.00");
    expect(valorDe(await m.casos.venderYCobrar(e.gerente, permitida))).toMatchObject({
      estado: "COBRADO",
    });
    expect(await existencia(dep, medialuna.articulo)).toBe("-2.0000");
    expect(await existencia(dep, harina.articulo)).toBe("10.0000");
    const [salida] = await movimientosDelEjemplar(permitida.ejemplarId);
    expect((await renglonesDe(salida?.id as string)).map((x) => x.articulo_id)).toEqual([
      medialuna.articulo,
    ]);
  });

  // ---- T-5 ------------------------------------------------------------------------------------------------------------------------

  it("T-5: una línea agregada ANTES de cargar la receta, en una cuenta abierta, no descuenta (`controla_stock` sellado): se documenta el comportamiento", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const harina = await insumo(mundo, "10", kilos);
    const plato = await producto(e, "VENDIBLE", "1000");
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
    const lineaId = nuevoId();
    valorDe(
      await m.casos.agregarLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId,
        productoId: plato,
        opcionIds: [],
        cantidad: "2",
      }),
    );
    // Sin receta ni artículo la línea no controla stock; recién ahora se carga la receta.
    await receta(e, plato, "1", [
      { ingrediente: harina.producto, bruto: "0.1", unidad: "KILOGRAMO" },
    ]);
    const marca = await m.filas<{ c: boolean }>(
      "select controla_stock as c from linea_cuenta where id = $1",
      [lineaId],
    );
    expect(marca[0]?.c).toBe(false);
    const ejemplarId = nuevoId();
    valorDe(await m.casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId }));
    expect(await existencia(dep, harina.articulo)).toBe("10.0000");
    expect(await movimientosDelEjemplar(ejemplarId)).toHaveLength(0);
    // Una línea nueva, agregada con la receta ya cargada, sí descuenta.
    const caja = await m.cajaAbierta(e);
    const nueva = pedidoDeMostrador(e, caja, plato, "2", "2000.00");
    valorDe(await m.casos.venderYCobrar(e.gerente, nueva));
    expect(await existencia(dep, harina.articulo)).toBe("9.8000");
  });

  // ---- T-6 ------------------------------------------------------------------------------------------------------------------------

  it("T-6: receta en gramos con el insumo en kilos: 3 platos de 250 g bajan exactamente 0,75 kg", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const harina = await insumo(mundo, "10", kilos);
    const plato = await producto(e, "VENDIBLE", "1000");
    await receta(e, plato, "1", [{ ingrediente: harina.producto, bruto: "250", unidad: "GRAMO" }]);
    const caja = await m.cajaAbierta(e);
    const pedido = pedidoDeMostrador(e, caja, plato, "3", "3000.00");
    valorDe(await m.casos.venderYCobrar(e.gerente, pedido));
    expect(await existencia(dep, harina.articulo)).toBe("9.2500");
  });

  it("T-6: una conversión que no cabe en 4 decimales NO se redondea en silencio: la receta se rechaza al guardar (CONVERSION_NO_EXACTA) y no queda nada; el plato sigue sin receta y sin descontar", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const harina = await insumo(mundo, "10", kilos);
    const plato = await producto(e, "VENDIBLE", "1000");
    // 0,05 g = 0,00005 kg: cinco decimales en la unidad de stock.
    const pedidoDeLaWeb = {
      productoId: plato,
      versionEsperada: 0,
      rinde: "1",
      pasos: "",
      lineas: [{ ingredienteId: harina.producto, bruto: "0.05", merma: "" }],
      unidades: { [harina.producto]: "GRAMO" },
    };
    const web = await guardarLaReceta(recetas, e.gerente, pedidoDeLaWeb);
    expect(web.ok).toBe(false);
    const caso = await stock.guardarComposicion(e.gerente, {
      productoId: plato,
      versionEsperada: 0,
      rinde: "1",
      componentes: [{ productoId: harina.producto, cantidad: "0.05", unidadId: "GRAMO" }],
    });
    expect(caso).toMatchObject({ ok: false, error: "CONVERSION_NO_EXACTA" });
    expect(await contar("composicion", e.empresa)).toBe(0);
    // Sin receta, vender el plato no toca el libro (D140) y la existencia no se mueve.
    const caja = await m.cajaAbierta(e);
    const pedido = pedidoDeMostrador(e, caja, plato, "1", "1000.00");
    valorDe(await m.casos.venderYCobrar(e.gerente, pedido));
    expect(await existencia(dep, harina.articulo)).toBe("10.0000");
    expect(await movimientosDelEjemplar(pedido.ejemplarId)).toHaveLength(0);
  });

  // ---- T-7 ------------------------------------------------------------------------------------------------------------------------

  it("T-7: dos empresas y dos sucursales venden a la vez el mismo tipo de plato con receta y cada una descuenta de SU depósito y SU libro", async () => {
    const a = await mundoNuevo();
    const b = await mundoNuevo();
    const deA = await pastaDeDosNiveles(a, "10");
    const deB = await pastaDeDosNiveles(b, "10");
    const cajaA = await m.cajaAbierta(a.e);
    const cajaB = await m.cajaAbierta(b.e);
    m.armarBarrera(2);
    try {
      const r = await Promise.all([
        firme(() =>
          m.casos.venderYCobrar(
            a.e.gerente,
            pedidoDeMostrador(a.e, cajaA, deA.pasta, "3", "3000.00"),
          ),
        ),
        firme(() =>
          m.casos.venderYCobrar(
            b.e.gerente,
            pedidoDeMostrador(b.e, cajaB, deB.pasta, "5", "5000.00"),
          ),
        ),
      ]);
      expect(r.every((x) => x.ok)).toBe(true);
    } finally {
      m.soltarBarrera();
    }
    expect(await existencia(a.dep, deA.tomate.articulo)).toBe("9.7000");
    expect(await existencia(b.dep, deB.tomate.articulo)).toBe("9.5000");
    expect(
      await m.filas(
        "select distinct empresa_id from movimiento_de_stock where deposito_id = $1 and clase = 'SALIDA'",
        [a.dep],
      ),
    ).toEqual([{ empresa_id: a.e.empresa }]);

    // Dos sucursales de la misma empresa: cada una descuenta de SU depósito de venta.
    const { e, dep } = a;
    const depNorte = await depositoDeBase(
      m.dueno,
      { empresa: e.empresa, sucursal: e.otraSucursal },
      { deVenta: true },
    );
    for (const articulo of [deA.tomate, deA.fideos]) {
      valorDe(
        await stock.registrarEntrada(e.gerente, {
          clave: nuevoId(),
          depositoId: depNorte,
          motivo: "COMPRA",
          renglones: [{ productoId: articulo.producto, cantidad: "10", unidadId: "KILOGRAMO" }],
        }),
      );
    }
    const cajaNorte = await m.cajaAbierta(e, { sucursal: e.otraSucursal });
    valorDe(
      await m.casos.venderYCobrar(
        e.gerente,
        pedidoDeMostrador(e, cajaNorte, deA.pasta, "2", "2000.00", e.otraSucursal),
      ),
    );
    expect(await existencia(depNorte, deA.tomate.articulo)).toBe("9.8000");
    expect(await existencia(dep, deA.tomate.articulo)).toBe("9.7000");
  });

  // ---- T-8 ------------------------------------------------------------------------------------------------------------------------

  it("T-8: una falla forzada después de la salida de stock y antes de cerrar la venta, con la receta de dos niveles: ni ticket, ni cobro, ni salida; el reintento cierra", async () => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const { tomate, fideos, pasta } = await pastaDeDosNiveles(mundo, "10");
    const caja = await m.cajaAbierta(e);
    const pedido = pedidoDeMostrador(e, caja, pasta, "3", "3000.00");
    fallaAlAuditar = "CUENTA_CERRADA";
    try {
      const r = await m.casos
        .venderYCobrar(e.gerente, pedido)
        .catch((x: unknown) => ({ ok: false as const, error: String(x) }));
      expect(r.ok).toBe(false);
    } finally {
      fallaAlAuditar = null;
    }
    expect(await existencia(dep, tomate.articulo)).toBe("10.0000");
    expect(await existencia(dep, fideos.articulo)).toBe("10.0000");
    expect(await contar("ticket", e.empresa)).toBe(0);
    expect(await contar("cobranza_de_ticket", e.empresa)).toBe(0);
    expect(await movimientosDelEjemplar(pedido.ejemplarId)).toHaveLength(0);
    // El reintento (el mismo pedido) cierra y descuenta una vez.
    expect(valorDe(await m.casos.venderYCobrar(e.gerente, pedido))).toMatchObject({
      estado: "COBRADO",
      yaExistia: false,
    });
    expect(await existencia(dep, tomate.articulo)).toBe("9.7000");
    expect(await contar("ticket", e.empresa)).toBe(1);
  });

  // ---- T-3 ------------------------------------------------------------------------------------------------------------------------

  /** Una panadería: harina (insumo), una masa elaborada con stock propio (receta: 6 kg de harina por 8 kg) y un pan que se vende (0,1 kg de harina por pan), con `harina` kg en el depósito de venta (origen de la orden). */
  const panaderiaConVenta = async (harina: string) => {
    const mundo = await mundoNuevo();
    const { e, dep } = mundo;
    const kg = await insumo(mundo, harina, kilos);
    const masa = await articuloDeBase(m.dueno, e, { clase: "ELABORADO", ...kilos });
    await receta(e, masa.producto, "8", [
      { ingrediente: kg.producto, bruto: "6", unidad: "KILOGRAMO" },
    ]);
    const pan = await producto(e, "VENDIBLE", "1000");
    await receta(e, pan, "1", [{ ingrediente: kg.producto, bruto: "0.1", unidad: "KILOGRAMO" }]);
    const destino = await depositoDeBase(m.dueno, e, {});
    const caja = await m.cajaAbierta(e);
    const orden = valorDe(
      await (m.produccion as NonNullable<typeof m.produccion>).abrirOrden(e.gerente, {
        id: nuevoId(),
        productoId: masa.producto,
        cantidad: "16",
        unidadId: "KILOGRAMO",
        depositoId: dep,
        depositoDestinoId: destino,
        confirmaciones: ["stock.existencia_negativa"],
      }),
    );
    const cerrarLaOrden = () =>
      (m.produccion as NonNullable<typeof m.produccion>).cerrarOrden(e.gerente, {
        ordenId: orden.ordenId,
        clave: nuevoId(),
        obtenido: "15",
        unidadId: "KILOGRAMO",
        consumos: [{ productoId: kg.producto, cantidadReal: "12", unidadId: "KILOGRAMO" }],
      });
    return { mundo, kg, masa, destino, caja, orden, pan, cerrarLaOrden };
  };
  const estadoDeLaOrden = async (ordenId: string) =>
    (
      await m.filas<{ estado: string }>("select estado from orden_de_produccion where id = $1", [
        ordenId,
      ])
    )[0]?.estado;
  const movimientosDeLaOrden = (ordenId: string) =>
    m.contar("select count(*) as n from movimiento_de_stock where origen_id = $1", [ordenId]);

  it("T-3: cerrar una orden (consume 12 kg de harina) a la vez que se vende un plato con harina (VENTA COMPLETA, ticket y cobro): sin interbloqueo, cada movimiento una vez y la existencia final es la inicial menos las dos salidas", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const p = await panaderiaConVenta("100");
      const { e, dep } = p.mundo;
      const venta = pedidoDeMostrador(e, p.caja, p.pan, "3", "3000.00");
      m.armarBarrera(2);
      let rs: readonly [{ readonly ok: boolean }, { readonly ok: boolean }];
      try {
        rs = await Promise.all([
          firme(() => p.cerrarLaOrden()),
          firme(() => m.casos.venderYCobrar(e.gerente, venta)),
        ]);
      } finally {
        m.soltarBarrera();
      }
      expect(
        rs.every((r) => r.ok),
        JSON.stringify(rs),
      ).toBe(true);
      expect(await estadoDeLaOrden(p.orden.ordenId)).toBe("CERRADA");
      expect(await movimientosDeLaOrden(p.orden.ordenId)).toBe(2);
      expect(await movimientosDelEjemplar(venta.ejemplarId)).toHaveLength(1);
      expect(await contar("ticket", e.empresa)).toBe(1);
      expect(await contar("cobranza_de_ticket", e.empresa)).toBe(1);
      // 100 − 12 (la orden) − 0,3 (3 panes) = 87,7; y la masa obtenida entra al destino.
      expect(await existencia(dep, p.kg.articulo)).toBe("87.7000");
      expect(await existencia(p.destino, p.masa.articulo)).toBe("15.0000");
    }
  });

  it("T-3 (existencia justa y AVISAR): con harina para UNA sola de las dos (12,2 kg: la orden necesita 12 y la venta 0,3) gana una; la otra frena entera sin dejar nada y la existencia no queda en negativo", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const p = await panaderiaConVenta("12.2");
      const { e, dep } = p.mundo;
      await fijarNivel(e.empresa, "AVISAR");
      const venta = pedidoDeMostrador(e, p.caja, p.pan, "3", "3000.00");
      m.armarBarrera(2);
      let rs: readonly [{ readonly ok: boolean }, { readonly ok: boolean }];
      try {
        rs = await Promise.all([
          firme(() => p.cerrarLaOrden()),
          firme(() => m.casos.venderYCobrar(e.gerente, venta)),
        ]);
      } finally {
        m.soltarBarrera();
      }
      const [cierre, ventaOk] = [rs[0].ok, rs[1].ok];
      expect(Number(cierre) + Number(ventaOk), JSON.stringify(rs)).toBe(1);
      const harina = await existencia(dep, p.kg.articulo);
      if (cierre) {
        expect(await estadoDeLaOrden(p.orden.ordenId)).toBe("CERRADA");
        expect(harina).toBe("0.2000");
        expect(await contar("ticket", e.empresa)).toBe(0);
        expect(await contar("cobranza_de_ticket", e.empresa)).toBe(0);
        expect(await movimientosDelEjemplar(venta.ejemplarId)).toHaveLength(0);
      } else {
        expect(await estadoDeLaOrden(p.orden.ordenId)).toBe("ABIERTA");
        expect(await movimientosDeLaOrden(p.orden.ordenId)).toBe(0);
        expect(harina).toBe("11.9000");
        expect(await contar("ticket", e.empresa)).toBe(1);
      }
      await fijarNivel(e.empresa, "PERMITIR");
    }
  });
});
