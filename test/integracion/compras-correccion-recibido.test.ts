import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { codigoDe } from "./concurrencia-apoyo";
import { cuitUnico } from "./entorno";
import { intentoDelDueno, sinConfirmar } from "./fiscal-apoyo";
import { numeroUnico } from "./unicos";

/**
 * Compras N3 (PR D): corregir lo recibido de una línea de una recepción separada ya confirmada. La recepción no se reabre: se suma una corrección con su causa, un movimiento de
 * stock por la diferencia y el saldo de la línea se ajusta en la base. Idempotencia, rechazos, permisos y alcance, aislamiento, el tope «no por debajo de lo conciliado», la existencia que
 * no queda en negativo, dos correcciones (o una corrección y una conciliación, o una anulación) a la vez con los roles reales, y la suma recibido/conciliado/stock que queda consistente.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras N3: corregir lo recibido", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    c.encenderPerilla("recepcion_separada");
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(
      await c.casos.configurarCompras(e.gerente, {
        nivel: "RECEPCION_SEPARADA",
        versionEsperada: 1,
      }),
    );
    const deposito = await c.deposito(e);
    const harina = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    return { e, deposito, harina, proveedor, cuit: cuitUnico() };
  };
  type M = Awaited<ReturnType<typeof armar>>;

  const registrar = async (m: M, kilos: string) =>
    valorDe(
      await c.casos.registrarRecepcion(m.e.operador, {
        clave: nuevoId(),
        sucursalId: m.e.sucursal,
        proveedorId: m.proveedor,
        renglones: [
          {
            productoId: m.harina.producto,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: kilos,
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1000",
          },
        ],
      }),
    ).recepcionId;
  /** Recibe y CONFIRMA una recepción de un solo renglón; devuelve su id. */
  const recibir = async (m: M, kilos: string) => {
    const id = await registrar(m, kilos);
    valorDe(
      await c.casos.confirmarRecepcion(m.e.gerente, { recepcionId: id, depositoId: m.deposito }),
    );
    return id;
  };
  const corregir = (
    m: M,
    recepcionId: string,
    cantidad: string,
    extra: Record<string, unknown> = {},
    quien = m.e.gerente,
  ) =>
    c.casos.corregirLoRecibido(quien, {
      clave: nuevoId(),
      recepcionId,
      linea: 1,
      correccionesVistas: 0,
      cantidad,
      causa: "ERROR_DE_CARGA",
      ...extra,
    } as Parameters<typeof c.casos.corregirLoRecibido>[1]);
  const saldo = async (recepcionId: string) =>
    (
      await c.filas<{ recibida: string; asignada: string }>(
        "select cantidad_recibida::text as recibida, cantidad_asignada::text as asignada from saldo_de_linea_de_recepcion where recepcion_id = $1 and numero = 1",
        [recepcionId],
      )
    )[0];
  const cargarFactura = async (m: M, gramos: number) =>
    valorDe(
      await c.casos.registrarFactura(m.e.operador, {
        clave: nuevoId(),
        proveedorId: m.proveedor,
        factura: {
          tipo: "FACTURA_A",
          puntoDeVenta: 5,
          numero: numeroUnico(),
          fecha: "2026-10-10",
          lineas: [
            {
              productoId: m.harina.producto,
              cantidadFacturada: String(gramos),
              precioNeto: "1",
              alicuota: "21",
            },
          ],
          totalSegunFactura: (gramos * 1.21).toFixed(2),
          cuitDelProveedor: m.cuit,
        },
      }),
    );
  const conciliar = (m: M, comprobanteId: string, recepcionId: string, cantidad: string) =>
    c.casos.conciliarFactura(m.e.gerente, {
      clave: nuevoId(),
      comprobanteId,
      asignaciones: [{ lineaDeFactura: 1, recepcionId, lineaDeRecepcion: 1, cantidad }],
    });
  const existencia = (m: M) => c.existencia(m.deposito, m.harina.articulo);

  it("recibieron MENOS: baja lo recibido, saca la diferencia del stock con su movimiento, deja la línea original como estaba y audita con causa y nota", async () => {
    const m = await armar();
    const r = await recibir(m, "2");
    expect(await existencia(m)).toBe("2000.0000");
    const hecha = valorDe(
      await corregir(m, r, "1500", { causa: "FALTANTE_DEL_PROVEEDOR", nota: "Faltaron 2 bolsas" }),
    );
    expect(hecha).toMatchObject({
      recepcionId: r,
      linea: 1,
      numero: 1,
      cantidadAnterior: "2000.0000",
      cantidadNueva: "1500.0000",
      yaExistia: false,
    });
    expect(await saldo(r)).toEqual({ recibida: "1500.0000", asignada: "0.0000" });
    expect(await existencia(m)).toBe("1500.0000");
    // La línea original conserva lo que se cargó: es el historial.
    expect(
      (
        await c.filas<{ q: string }>(
          "select cantidad_en_stock::text as q from linea_de_recepcion where recepcion_id = $1 and numero = 1",
          [r],
        )
      )[0]?.q,
    ).toBe("2000.0000");
    const [correccion] = await c.filas<Record<string, unknown>>(
      "select id, numero, cantidad_anterior::text as a, cantidad_nueva::text as n, causa, nota, movimiento_id, registrado_por from correccion_de_lo_recibido where recepcion_id = $1",
      [r],
    );
    expect(correccion).toMatchObject({
      numero: 1,
      a: "2000.0000",
      n: "1500.0000",
      causa: "FALTANTE_DEL_PROVEEDOR",
      nota: "Faltaron 2 bolsas",
      registrado_por: m.e.personaDelGerente,
    });
    const [movimiento] = await c.filas<Record<string, unknown>>(
      "select clase, motivo, origen_tipo, origen_id, deposito_id from movimiento_de_stock where id = $1",
      [correccion?.["movimiento_id"]],
    );
    expect(movimiento).toMatchObject({
      clase: "SALIDA",
      motivo: "CORRECCION_DE_RECEPCION",
      origen_tipo: "CORRECCION_DE_RECEPCION",
      origen_id: correccion?.["id"],
      deposito_id: m.deposito,
    });
    expect((await c.auditoria(m.e.empresa, "COMPRA_CORREGIDA")).at(-1)).toMatchObject({
      actor_persona_id: m.e.personaDelGerente,
      entidad: "recepcion",
      entidad_id: r,
      antes: { linea: 1, cantidadRecibida: "2000.0000" },
      despues: {
        tipo: "CANTIDAD_RECIBIDA",
        numero: 1,
        cantidadRecibida: "1500.0000",
        causa: "FALTANTE_DEL_PROVEEDOR",
        nota: "Faltaron 2 bolsas",
      },
    });
  });

  it("recibieron MÁS: sube lo recibido y entra la diferencia al stock con su movimiento de entrada", async () => {
    const m = await armar();
    const r = await recibir(m, "2");
    valorDe(await corregir(m, r, "2600", { causa: "REPARTO_INTERNO" }));
    expect(await saldo(r)).toEqual({ recibida: "2600.0000", asignada: "0.0000" });
    expect(await existencia(m)).toBe("2600.0000");
    const [mov] = await c.filas<{ clase: string; motivo: string }>(
      "select m.clase, m.motivo from movimiento_de_stock m join correccion_de_lo_recibido k on k.movimiento_id = m.id where k.recepcion_id = $1",
      [r],
    );
    expect(mov).toEqual({ clase: "ENTRADA", motivo: "CORRECCION_DE_RECEPCION" });
  });

  it("I1: la misma corrección dos veces (misma clave) deja una sola fila y un solo movimiento y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const r = await recibir(m, "2");
    const pedido = {
      clave: nuevoId(),
      recepcionId: r,
      linea: 1,
      correccionesVistas: 0,
      cantidad: "1500",
      causa: "ERROR_DE_CARGA" as const,
    };
    const primera = valorDe(await c.casos.corregirLoRecibido(m.e.gerente, pedido));
    const auditadas = (await c.auditoria(m.e.empresa, "COMPRA_CORREGIDA")).length;
    const segunda = valorDe(await c.casos.corregirLoRecibido(m.e.administrador, pedido));
    expect(primera.yaExistia).toBe(false);
    expect(segunda).toMatchObject({ yaExistia: true, numero: 1, cantidadNueva: "1500.0000" });
    expect((await c.auditoria(m.e.empresa, "COMPRA_CORREGIDA")).length).toBe(auditadas);
    expect(
      await c.contar(
        "select count(*) as n from correccion_de_lo_recibido where recepcion_id = $1",
        [r],
      ),
    ).toBe(1);
    expect(
      await c.contar(
        "select count(*) as n from movimiento_de_stock where origen_tipo = 'CORRECCION_DE_RECEPCION' and empresa_id = $1",
        [m.e.empresa],
      ),
    ).toBe(1);
    expect(await existencia(m)).toBe("1500.0000");
    expect(await c.casos.corregirLoRecibido(m.e.gerente, { ...pedido, cantidad: "1400" })).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
    expect(
      await c.casos.corregirLoRecibido(m.e.gerente, { ...pedido, causa: "REPARTO_INTERNO" }),
    ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
    expect(await existencia(m)).toBe("1500.0000");
  });

  it("las correcciones se encadenan sobre la cantidad vigente; una con la versión vieja es CORRECCION_DESACTUALIZADA y no escribe", async () => {
    const m = await armar();
    const r = await recibir(m, "2");
    valorDe(await corregir(m, r, "1500"));
    const segunda = valorDe(await corregir(m, r, "1800", { correccionesVistas: 1 }));
    expect(segunda).toMatchObject({
      numero: 2,
      cantidadAnterior: "1500.0000",
      cantidadNueva: "1800.0000",
    });
    expect(await corregir(m, r, "1000", { correccionesVistas: 1 })).toEqual({
      ok: false,
      error: "CORRECCION_DESACTUALIZADA",
    });
    expect(await corregir(m, r, "1000", { correccionesVistas: 0 })).toEqual({
      ok: false,
      error: "CORRECCION_DESACTUALIZADA",
    });
    expect(await saldo(r)).toEqual({ recibida: "1800.0000", asignada: "0.0000" });
    expect(await existencia(m)).toBe("1800.0000");
  });

  it("rechazos genéricos y sin escribir: cantidad igual, no positiva o mal escrita, causa fuera de la lista, nota inválida, línea inexistente, clave inválida", async () => {
    const m = await armar();
    const r = await recibir(m, "2");
    const antes = await c.contar("select count(*) as n from correccion_de_lo_recibido");
    expect(await corregir(m, r, "2000")).toEqual({ ok: false, error: "SIN_CAMBIOS" });
    expect(await corregir(m, r, "2000.0000")).toEqual({ ok: false, error: "SIN_CAMBIOS" });
    for (const q of ["0", "-5", "abc", "", "1e3", "1,5", "100000000000000"]) {
      expect(await corregir(m, r, q), q).toEqual({ ok: false, error: "CANTIDAD_INVALIDA" });
    }
    expect(await corregir(m, r, "1500", { causa: "OTRA" })).toEqual({
      ok: false,
      error: "CAUSA_DE_CORRECCION_INVALIDA",
    });
    expect(await corregir(m, r, "1500", { causa: undefined })).toEqual({
      ok: false,
      error: "CAUSA_DE_CORRECCION_INVALIDA",
    });
    expect(await corregir(m, r, "1500", { nota: "x".repeat(201) })).toEqual({
      ok: false,
      error: "NOTA_DE_CORRECCION_INVALIDA",
    });
    expect(await corregir(m, r, "1500", { nota: "=1+1" })).toEqual({
      ok: false,
      error: "NOTA_DE_CORRECCION_INVALIDA",
    });
    expect(await corregir(m, r, "1500", { linea: 9 })).toEqual({
      ok: false,
      error: "LINEA_NO_ENCONTRADA",
    });
    expect(await corregir(m, r, "1500", { clave: "no-es-uuid" })).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
    expect(await corregir(m, nuevoId(), "1500")).toEqual({
      ok: false,
      error: "RECEPCION_NO_ENCONTRADA",
    });
    expect(await c.contar("select count(*) as n from correccion_de_lo_recibido")).toBe(antes);
    expect(await existencia(m)).toBe("2000.0000");
    // La nota es opcional: vacía o ausente pasa.
    valorDe(await corregir(m, r, "1900", { nota: "" }));
  });

  it("una recepción pendiente no se corrige (no entró nada al stock) y la de otro nivel no existe para este caso", async () => {
    const m = await armar();
    const pendiente = await registrar(m, "2");
    expect(await corregir(m, pendiente, "1500")).toEqual({
      ok: false,
      error: "RECEPCION_NO_CONFIRMADA",
    });
    const otra = await c.escenario(); // COMPRA_SIMPLE: la recepción nace confirmada y de otro nivel
    const deposito = await c.deposito(otra);
    const { producto } = await c.articulo(otra, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(otra.operador);
    const compra = valorDe(
      await c.casos.registrarCompra(otra.operador, {
        clave: nuevoId(),
        sucursalId: otra.sucursal,
        proveedorId: proveedor,
        depositoId: deposito,
        renglones: [
          {
            productoId: producto,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "2",
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1000",
          },
        ],
      }),
    );
    expect(
      await c.casos.corregirLoRecibido(otra.gerente, {
        clave: nuevoId(),
        recepcionId: compra.recepcionId,
        linea: 1,
        correccionesVistas: 0,
        cantidad: "1500",
        causa: "ERROR_DE_CARGA",
      }),
    ).toEqual({ ok: false, error: "RECEPCION_NO_ENCONTRADA" });
  });

  it("permisos y alcance: el operador no corrige; otra empresa no ve la recepción; una sucursal fuera del alcance de quien corrige se rechaza", async () => {
    const m = await armar();
    const r = await recibir(m, "2");
    expect(await corregir(m, r, "1500", {}, m.e.operador)).toMatchObject({ ok: false });
    expect(codigoDe(await corregir(m, r, "1500", {}, m.e.operador))).toBe("SIN_PERMISO");
    const ajena = await armar();
    expect(await corregir(ajena, r, "1500", {}, ajena.e.gerente)).toEqual({
      ok: false,
      error: "RECEPCION_NO_ENCONTRADA",
    });
    // Un delegado limitado a la otra sucursal no corrige la de «Casa central»; limitado a la suya, sí.
    c.alcances.set(m.e.personaDelGerente, [m.e.otraSucursal]);
    try {
      expect(await corregir(m, r, "1500")).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      c.alcances.set(m.e.personaDelGerente, [m.e.sucursal]);
      valorDe(await corregir(m, r, "1500"));
    } finally {
      c.alcances.delete(m.e.personaDelGerente);
    }
    expect(await saldo(r)).toEqual({ recibida: "1500.0000", asignada: "0.0000" });
    expect(await existencia(m)).toBe("1500.0000");
  });

  it("no baja de lo ya conciliado: se rechaza sin escribir; subir sí; anulada la conciliación, baja", async () => {
    const m = await armar();
    const r = await recibir(m, "2");
    const f = await cargarFactura(m, 2000);
    const hecha = valorDe(await conciliar(m, f.comprobanteId, r, "2000"));
    expect(await corregir(m, r, "1500")).toEqual({
      ok: false,
      error: "CORRECCION_BAJO_LO_CONCILIADO",
    });
    expect(await corregir(m, r, "1999.9999")).toEqual({
      ok: false,
      error: "CORRECCION_BAJO_LO_CONCILIADO",
    });
    expect(await saldo(r)).toEqual({ recibida: "2000.0000", asignada: "2000.0000" });
    expect(await existencia(m)).toBe("2000.0000");
    valorDe(await corregir(m, r, "2500", { causa: "REPARTO_INTERNO" }));
    expect(await saldo(r)).toEqual({ recibida: "2500.0000", asignada: "2000.0000" });
    // Se puede bajar hasta lo conciliado, no más.
    valorDe(await corregir(m, r, "2000", { correccionesVistas: 1 }));
    valorDe(
      await c.casos.anularConciliacion(m.e.gerente, { conciliacionId: hecha.conciliacionId }),
    );
    valorDe(await corregir(m, r, "1500", { correccionesVistas: 2 }));
    expect(await saldo(r)).toEqual({ recibida: "1500.0000", asignada: "0.0000" });
    expect(await existencia(m)).toBe("1500.0000");
  });

  it("existencia negativa: con el control en AVISAR, bajar más de lo que queda sin confirmar se rechaza y no queda nada a medias; confirmado, pasa y queda auditado; con PERMITIR pasa", async () => {
    const m = await armar();
    await c.dueno.query(
      "insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, null, 'stock.existencia_negativa', 'AVISAR')",
      [m.e.empresa],
    );
    const r = await recibir(m, "2");
    valorDe(
      await c.stockCasos.registrarSalida(m.e.gerente, {
        clave: nuevoId(),
        depositoId: m.deposito,
        motivo: "MERMA",
        detalle: "se tiró",
        renglones: [{ productoId: m.harina.producto, cantidad: "1900", unidadId: "GRAMO" }],
      }),
    );
    expect(await existencia(m)).toBe("100.0000");
    const rechazada = await corregir(m, r, "1000");
    expect(rechazada.ok).toBe(false);
    expect(await saldo(r)).toEqual({ recibida: "2000.0000", asignada: "0.0000" });
    expect(await existencia(m)).toBe("100.0000");
    expect(
      await c.contar(
        "select count(*) as n from correccion_de_lo_recibido where recepcion_id = $1",
        [r],
      ),
    ).toBe(0);
    expect(
      await c.contar(
        "select count(*) as n from movimiento_de_stock where origen_tipo = 'CORRECCION_DE_RECEPCION' and empresa_id = $1",
        [m.e.empresa],
      ),
    ).toBe(0);
    // Bajar lo que sí queda se puede: 2000 → 1900 saca 100.
    valorDe(await corregir(m, r, "1900"));
    expect(await existencia(m)).toBe("0.0000");
    // Confirmando que va a quedar en negativo, pasa y deja la excepción en la auditoría.
    valorDe(
      await corregir(m, r, "1500", { correccionesVistas: 1, confirmoExistenciaNegativa: true }),
    );
    expect(await existencia(m)).toBe("-400.0000");
    expect((await c.auditoria(m.e.empresa, "COMPRA_CORREGIDA")).at(-1)).toMatchObject({
      despues: { existenciaNegativa: 1 },
    });
  });

  it("C1: dos correcciones de la misma línea a la vez: gana una, la otra ve CORRECCION_DESACTUALIZADA; lo recibido y el stock son los de la ganadora", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const r = await recibir(m, "2");
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          corregir(m, r, "1500", { causa: "FALTANTE_DEL_PROVEEDOR" }, m.e.gerente),
          corregir(m, r, "1700", { causa: "REPARTO_INTERNO" }, m.e.administrador),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(rs.filter((x) => x.ok)).toHaveLength(1);
      expect(rs.filter((x) => !x.ok).map((x) => (x.ok ? "" : x.error))).toEqual([
        "CORRECCION_DESACTUALIZADA",
      ]);
      const ganadora = rs.find((x) => x.ok);
      const vigente = ganadora?.ok ? ganadora.valor.cantidadNueva : "";
      expect((await saldo(r))?.recibida).toBe(vigente);
      expect(await existencia(m)).toBe(vigente);
      expect(
        await c.contar(
          "select count(*) as n from correccion_de_lo_recibido where recepcion_id = $1",
          [r],
        ),
      ).toBe(1);
    }
  });

  it("C2: una corrección a la baja y una conciliación a la vez: lo conciliado nunca supera lo recibido, y el stock sigue lo recibido", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const r = await recibir(m, "2");
      const f = await cargarFactura(m, 2000);
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          corregir(m, r, "1500", {}, m.e.gerente),
          conciliar(m, f.comprobanteId, r, "2000"),
        ]);
      } finally {
        c.soltarBarrera();
      }
      const final = await saldo(r);
      expect(Number(final?.asignada)).toBeLessThanOrEqual(Number(final?.recibida));
      expect(await existencia(m)).toBe(final?.recibida);
      // O gana la corrección (y la conciliación de 2000 excede lo recibido) o gana la conciliación (y la corrección queda bajo lo conciliado): nunca las dos.
      expect(rs.filter((x) => x.ok)).toHaveLength(1);
    }
  });

  it("C3: una corrección a la baja y la anulación de la conciliación a la vez: la anulación siempre sale y el estado queda de acuerdo", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const r = await recibir(m, "2");
      const f = await cargarFactura(m, 2000);
      const hecha = valorDe(await conciliar(m, f.comprobanteId, r, "2000"));
      c.armarBarrera(2);
      let rs;
      try {
        rs = await Promise.all([
          corregir(m, r, "1500", {}, m.e.gerente),
          c.casos.anularConciliacion(m.e.administrador, { conciliacionId: hecha.conciliacionId }),
        ]);
      } finally {
        c.soltarBarrera();
      }
      expect(rs[1].ok).toBe(true);
      const final = await saldo(r);
      expect(final?.asignada).toBe("0.0000");
      expect(Number(final?.asignada)).toBeLessThanOrEqual(Number(final?.recibida));
      expect(await existencia(m)).toBe(final?.recibida);
      // Si la corrección perdió la carrera, se repite sin más y sale.
      if (!rs[0].ok) valorDe(await corregir(m, r, "1500"));
      expect((await saldo(r))?.recibida).toBe("1500.0000");
      expect(await existencia(m)).toBe("1500.0000");
    }
  });

  it("propiedad: tras cualquier cadena de correcciones, lo recibido es la última cantidad, el stock la sigue y la suma de los movimientos es la diferencia con lo original", async () => {
    const m = await armar();
    const r = await recibir(m, "2");
    const cadena = ["1500", "2400", "100", "2000.5", "2000.4999", "3000"];
    let vistas = 0;
    for (const q of cadena) {
      valorDe(await corregir(m, r, q, { correccionesVistas: vistas }));
      vistas += 1;
      const final = await saldo(r);
      expect(Number(final?.recibida)).toBe(Number(q));
      expect(Number(await existencia(m))).toBe(Number(q));
    }
    const [suma] = await c.filas<{ s: string }>(
      `select coalesce(sum(rm.cantidad), 0)::text as s from renglon_de_movimiento rm
         join correccion_de_lo_recibido k on k.movimiento_id = rm.movimiento_id and k.empresa_id = rm.empresa_id where k.recepcion_id = $1`,
      [r],
    );
    expect(Number(suma?.s)).toBe(3000 - 2000);
    const numeros = await c.filas<{ numero: number }>(
      "select numero from correccion_de_lo_recibido where recepcion_id = $1 order by numero",
      [r],
    );
    expect(numeros.map((x) => x.numero)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("las lecturas dicen lo vigente: tras corregir 2000 → 1500 la propuesta, el detalle de la factura, la ficha y la lista de la recepción y el estado de la factura dicen 1500; la línea original conserva 2000", async () => {
    const m = await armar();
    const r = await recibir(m, "2");
    const f = await cargarFactura(m, 2000);
    const antes = valorDe(
      await c.consultas.proponerConciliacion(m.e.gerente, { comprobanteId: f.comprobanteId }),
    );
    expect(antes?.recibidas[0]).toMatchObject({ recibida: "2000.0000", sinAsignar: "2000.0000" });
    valorDe(
      await corregir(m, r, "1500", { causa: "FALTANTE_DEL_PROVEEDOR", nota: "Faltaron 2 bolsas" }),
    );
    const propuesta = valorDe(
      await c.consultas.proponerConciliacion(m.e.gerente, { comprobanteId: f.comprobanteId }),
    );
    expect(propuesta?.recibidas[0]).toMatchObject({
      recibida: "1500.0000",
      sinAsignar: "1500.0000",
    });
    expect(propuesta?.asignaciones).toEqual([
      { lineaDeFactura: 1, recepcionId: r, lineaDeRecepcion: 1, cantidad: "1500.0000" },
    ]);
    const fichaDeFactura = valorDe(
      await c.consultas.fichaDeFacturaSeparada(m.e.gerente, { comprobanteId: f.comprobanteId }),
    );
    expect(fichaDeFactura?.lineas[0]?.recibidoPorSucursal).toEqual([
      { sucursalId: m.e.sucursal, recibida: "1500.0000", sinConciliar: "1500.0000" },
    ]);
    // La ficha de la recepción: lo que rige hoy y la historia; lo cargado queda como estaba.
    const ficha = valorDe(
      await c.consultas.fichaDeRecepcionSeparada(m.e.gerente, { recepcionId: r }),
    );
    expect(ficha?.lineas[0]).toMatchObject({
      cantidadEnStock: "2000.0000",
      cantidadRecibida: "1500.0000",
      correccionesVistas: 1,
      correcciones: [
        {
          numero: 1,
          cantidadAnterior: "2000.0000",
          cantidadNueva: "1500.0000",
          causa: "FALTANTE_DEL_PROVEEDOR",
          nota: "Faltaron 2 bolsas",
        },
      ],
    });
    // Conciliar lo que llegó deja la factura «Conciliada en parte»: faltan 500 por reclamar al proveedor.
    valorDe(
      await c.casos.conciliarFactura(m.e.gerente, {
        clave: nuevoId(),
        comprobanteId: f.comprobanteId,
        asignaciones: [
          { lineaDeFactura: 1, recepcionId: r, lineaDeRecepcion: 1, cantidad: "1500" },
        ],
      }),
    );
    const despues = valorDe(
      await c.consultas.fichaDeFacturaSeparada(m.e.gerente, { comprobanteId: f.comprobanteId }),
    );
    expect(despues?.estado).toBe("CONCILIADA_EN_PARTE");
    expect(despues?.lineas[0]).toMatchObject({ facturada: "2000.0000", conciliada: "1500.0000" });
    // Tampoco se puede conciliar de más sobre lo corregido: la base ve 1500.
    const f2 = await cargarFactura(m, 2000);
    expect(await conciliar(m, f2.comprobanteId, r, "100")).toMatchObject({ ok: false });
    expect(await saldo(r)).toEqual({ recibida: "1500.0000", asignada: "1500.0000" });
  });

  it("la base lo impide aunque el servidor se olvide: el saldo no se toca a mano y una corrección sin su movimiento, salteada o de otra cantidad no entra", async () => {
    const m = await armar();
    const r = await recibir(m, "2");
    const [entrada] = await c.filas<{ movimiento_id: string }>(
      "select movimiento_id from entrada_de_linea_de_recepcion where recepcion_id = $1",
      [r],
    );
    const insertar = (extra: Record<string, unknown>) => {
      const valores: Record<string, unknown> = {
        id: nuevoId(),
        empresa_id: m.e.empresa,
        recepcion_id: r,
        linea: 1,
        numero: 1,
        cantidad_anterior: "2000",
        cantidad_nueva: "1500",
        causa: "ERROR_DE_CARGA",
        movimiento_id: entrada?.movimiento_id,
        clave_idempotencia: nuevoId(),
        huella: "a".repeat(64),
        registrado_por: m.e.personaDelGerente,
        ...extra,
      };
      const nombres = Object.keys(valores);
      return intentoDelDueno(
        c.dueno,
        `insert into correccion_de_lo_recibido (${nombres.join(", ")}) values (${nombres.map((_, i) => `$${i + 1}`).join(", ")})`,
        Object.values(valores),
      );
    };
    await sinConfirmar(c.dueno, async () => {
      expect(
        await intentoDelDueno(
          c.dueno,
          "update saldo_de_linea_de_recepcion set cantidad_recibida = 1 where recepcion_id = $1 and numero = 1",
          [r],
        ),
      ).toMatchObject({
        ok: false,
        restriccion: "saldo_de_linea_de_recepcion_solo_por_disparadores",
      });
      // El movimiento que existe es el de la entrada original: no es de esta corrección.
      expect(await insertar({})).toMatchObject({
        ok: false,
        restriccion: "correccion_de_lo_recibido_movimiento_ck",
      });
      expect(await insertar({ numero: 3 })).toMatchObject({ ok: false });
      expect(await insertar({ cantidad_nueva: "2000" })).toMatchObject({
        ok: false,
        restriccion: "correccion_de_lo_recibido_cambia_ck",
      });
      expect(await insertar({ causa: "OTRA" })).toMatchObject({
        ok: false,
        restriccion: "correccion_de_lo_recibido_causa_ck",
      });
      expect(await insertar({ nota: "x".repeat(201) })).toMatchObject({
        ok: false,
        restriccion: "correccion_de_lo_recibido_nota_ck",
      });
    });
    expect(await saldo(r)).toEqual({ recibida: "2000.0000", asignada: "0.0000" });
    // Una corrección hecha por el caso de uso no se edita ni se borra.
    valorDe(await corregir(m, r, "1500"));
    await sinConfirmar(c.dueno, async () => {
      expect(
        await intentoDelDueno(
          c.dueno,
          "update correccion_de_lo_recibido set nota = 'x' where recepcion_id = $1",
          [r],
        ),
      ).toMatchObject({ ok: false });
      expect(
        await intentoDelDueno(
          c.dueno,
          "delete from correccion_de_lo_recibido where recepcion_id = $1",
          [r],
        ),
      ).toMatchObject({ ok: false });
    });
  });
});
