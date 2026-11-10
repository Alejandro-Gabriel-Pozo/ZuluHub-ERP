import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import {
  crearCasosDeUsoDeCierre,
  huellaDeControles,
  type AporteAlCierreDelDia,
} from "../../src/modulos/cierre/publico";
import { aporteDeVentas, crearCasosDeUsoDeVentas } from "../../src/modulos/ventas/publico";
import { crearEntornoDePrueba, type TxDePrueba } from "./entorno";
import { productoDeBase } from "./catalogo-apoyo";
import { crearPersonaDeBase } from "./fixtures-identidad";
import {
  FECHA_DE_NEGOCIO,
  cuentaConLinea,
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Ventas (E4 fase A) con los casos de uso reales sobre una base real y el rol de la aplicación: idempotencia de cada comando (I1 a I6),
 * el flujo de la cuenta al ticket, el precio y la foto de opciones congelados, la cantidad decimal exacta (P25), el reparto del centavo
 * (P3), la cortesía (P12), la fecha de negocio por reloj (P17, parte reloj), la auditoría, la autorización y el alcance (P15), el
 * aislamiento entre empresas (P14), la jornada del cierre del día (P26), la anulación del ticket (P27, P29) y la atomicidad (P5).
 * Lo de cobrar y la fecha por sesión de caja es de la fase B y no se prueba acá. El esquema se prueba en `ventas-migracion.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const REGLAS: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    catalogo: { ...CATALOGO_DE_MODULOS.catalogo, estado: "disponible" },
    ventas: { ...CATALOGO_DE_MODULOS.ventas, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

type Fila = Record<string, unknown>;

/** Un error esperado: los comandos devuelven errores como datos, y acá se exige que haya uno. */
function falla<E>(r: Readonly<{ ok: true; valor: unknown } | { ok: false; error: E }>): E {
  if (r.ok) throw new Error(`se esperaba un error y vino ok ${JSON.stringify(r.valor)}`);
  return r.error;
}

/** Lo mismo que el contexto, con otro instante (el reloj lo manda el servidor; la prueba lo fija). */
const en = (contexto: ContextoOperativo, instante: string): ContextoOperativo => ({
  ...contexto,
  ahora: new Date(instante),
});

describe.skipIf(base === null)("ventas: casos de uso", () => {
  let m: MundoDeVentas;
  beforeAll(async () => {
    if (base !== null) m = await montarVentas(base);
  });
  afterAll(async () => {
    await m.cerrar();
  });

  // ---- atajos -----------------------------------------------------------------------------------------------------------------

  const abrir = async (e: EscenarioDeVentas, contexto = e.gerente, sucursal = e.sucursal) => {
    const id = nuevoId();
    valorDe(await m.casos.abrirCuenta(contexto, { cuentaId: id, sucursalId: sucursal }));
    return id;
  };
  const agregar = (
    contexto: ContextoOperativo,
    cuenta: string,
    producto: string,
    cantidad = "1",
    extra: Partial<Parameters<MundoDeVentas["casos"]["agregarLinea"]>[1]> = {},
  ) => {
    const lineaId = nuevoId();
    return m.casos
      .agregarLinea(contexto, {
        cuentaId: cuenta,
        lineaId,
        productoId: producto,
        opcionIds: [],
        cantidad,
        ...extra,
      })
      .then((r) => ({ lineaId, r }));
  };
  const cerrar = (
    contexto: ContextoOperativo,
    cuenta: string,
    extra: Partial<Parameters<MundoDeVentas["casos"]["cerrarCuenta"]>[1]> = {},
  ) => m.casos.cerrarCuenta(contexto, { cuentaId: cuenta, ejemplarId: nuevoId(), ...extra });
  const anularTicket = (
    contexto: ContextoOperativo,
    t: Readonly<{ ticketId: string; ejemplarId: string }>,
    extra: Partial<Parameters<MundoDeVentas["casos"]["anularTicket"]>[1]> = {},
  ) =>
    m.casos.anularTicket(contexto, {
      claveIdempotencia: nuevaClave(),
      ticketId: t.ticketId,
      ejemplarBaseId: t.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Error del cajero",
      ...extra,
    });
  /** Una venta cerrada (ticket EMITIDO) de un producto. */
  const ticketDe = async (
    e: EscenarioDeVentas,
    contexto = e.gerente,
    producto = e.producto,
    cantidad = "1",
  ) => {
    const cuenta = await abrir(e, contexto);
    valorDe((await agregar(contexto, cuenta, producto, cantidad)).r);
    const t = valorDe(await cerrar(contexto, cuenta));
    return { cuenta, ...t };
  };
  const contar = (tabla: string, empresa: string) =>
    m.contar(`select count(*) as n from ${tabla} where empresa_id = $1`, [empresa]);
  const numerador = async (e: EscenarioDeVentas) =>
    (
      await m.filas<{ ultimo: number }>(
        "select ultimo from numerador_ticket where empresa_id = $1 and sucursal_id = $2",
        [e.empresa, e.sucursal],
      )
    )[0]?.ultimo ?? 0;
  const cuentaEn = async (id: string) =>
    (
      await m.filas<{ estado: string; total: string; posicion: number }>(
        "select estado, total_provisorio::text as total, ultima_posicion as posicion from cuenta_consumo where id = $1",
        [id],
      )
    )[0];
  const lineasDe = (cuenta: string) =>
    m.filas(
      `select posicion, estado, precio_base::text as base, precio_unitario::text as unitario, cantidad::text as cantidad,
              paso_de_cantidad::text as paso, unidad_de_venta as unidad, descripcion
         from linea_cuenta where cuenta_id = $1 order by posicion`,
      [cuenta],
    );
  const renglones = async (ticketId: string) =>
    (
      await m.filas<{ importe: string }>(
        `select el.importe::text as importe from ejemplar_linea el
           join ticket_ejemplar x on x.id = el.ejemplar_id and x.empresa_id = el.empresa_id
           join linea_cuenta l on l.id = el.linea_cuenta_id and l.empresa_id = el.empresa_id
          where x.ticket_id = $1 and x.numero_de_ejemplar = 1 order by l.posicion`,
        [ticketId],
      )
    ).map((r) => r.importe);
  const sinCambios = async (e: EscenarioDeVentas) => ({
    cuentas: await contar("cuenta_consumo", e.empresa),
    lineas: await contar("linea_cuenta", e.empresa),
    tickets: await contar("ticket", e.empresa),
    ejemplares: await contar("ticket_ejemplar", e.empresa),
    auditoria: await contar("auditoria_empresa", e.empresa),
    ultimo: await numerador(e),
  });

  // ---- idempotencia (I1 a I6) -------------------------------------------------------------------------------------------------

  it("I1: repetir abrirCuenta con el mismo id deja una cuenta y devuelve yaExistia; con otro contenido, CUENTA_ID_EN_USO", async () => {
    const e = await m.escenario();
    const id = nuevoId();
    const ancla = { tipo: "salon.mesa", id: nuevoId() };
    const pedido = { cuentaId: id, sucursalId: e.sucursal, ancla, etiqueta: "Mesa 4" };
    expect(valorDe(await m.casos.abrirCuenta(e.gerente, pedido))).toEqual({
      cuentaId: id,
      yaExistia: false,
    });
    expect(valorDe(await m.casos.abrirCuenta(e.gerente, pedido))).toEqual({
      cuentaId: id,
      yaExistia: true,
    });
    expect(await contar("cuenta_consumo", e.empresa)).toBe(1);
    expect((await m.auditoria(e.empresa, "CUENTA_ABIERTA")).length).toBe(1);
    // El mismo id con otra sucursal, otra etiqueta, sin ancla o con otra ancla es otra cosa: no se pisa ni se acepta.
    for (const otro of [
      { sucursalId: e.otraSucursal },
      { etiqueta: "Mesa 5" },
      { ancla: { tipo: "salon.mesa", id: nuevoId() } },
      { ancla: undefined },
      { etiqueta: undefined },
    ]) {
      expect(
        falla(await m.casos.abrirCuenta(e.gerente, { ...pedido, ...otro })),
        JSON.stringify(otro),
      ).toBe("CUENTA_ID_EN_USO");
    }
    expect(await contar("cuenta_consumo", e.empresa)).toBe(1);
    expect((await m.auditoria(e.empresa, "CUENTA_ABIERTA")).length).toBe(1);
  });

  it("I2: repetir agregarLinea con el mismo id deja una línea y devuelve yaExistia; con otro contenido, LINEA_ID_EN_USO", async () => {
    const e = await m.escenario();
    const cuenta = await abrir(e);
    const lineaId = nuevoId();
    const pedido = {
      cuentaId: cuenta,
      lineaId,
      productoId: e.producto,
      opcionIds: [],
      cantidad: "2",
    };
    const primera = valorDe(await m.casos.agregarLinea(e.gerente, pedido));
    expect(primera).toEqual({
      posicion: 1,
      precioUnitario: { moneda: "ARS", monto: "1000.000000" },
      totalProvisorio: { moneda: "ARS", monto: "2000.00" },
      yaExistia: false,
    });
    expect(valorDe(await m.casos.agregarLinea(e.gerente, pedido))).toEqual({
      ...primera,
      yaExistia: true,
    });
    // "2" y "2.0000" son la misma cantidad.
    expect(
      valorDe(await m.casos.agregarLinea(e.gerente, { ...pedido, cantidad: "2.0000" })),
    ).toEqual({ ...primera, yaExistia: true });
    expect(await contar("linea_cuenta", e.empresa)).toBe(1);
    expect((await cuentaEn(cuenta))?.posicion).toBe(1);
    expect((await m.auditoria(e.empresa, "LINEA_AGREGADA")).length).toBe(1);
    const otroProducto = await m.productoVendible(e.empresa, "500");
    const otraCuenta = await abrir(e);
    for (const otro of [
      { cantidad: "3" },
      { productoId: otroProducto },
      { cuentaId: otraCuenta },
      { opcionIds: [nuevoId()] },
    ]) {
      expect(
        falla(await m.casos.agregarLinea(e.gerente, { ...pedido, ...otro })),
        JSON.stringify(otro),
      ).toBe("LINEA_ID_EN_USO");
    }
    expect(await contar("linea_cuenta", e.empresa)).toBe(1);
    expect((await cuentaEn(otraCuenta))?.posicion).toBe(0);
    expect((await m.auditoria(e.empresa, "LINEA_AGREGADA")).length).toBe(1);
  });

  it("I3: anular dos veces la misma línea es ok y no audita la segunda", async () => {
    const e = await m.escenario();
    const { cuenta, linea } = await cuentaConLinea(m, e);
    const pedido = { cuentaId: cuenta, lineaId: linea, motivo: "Se equivocó el cliente" };
    expect(valorDe(await m.casos.anularLinea(e.gerente, pedido))).toEqual({
      yaEstabaAnulada: false,
      totalProvisorio: { moneda: "ARS", monto: "0.00" },
    });
    const antes = await sinCambios(e);
    expect(valorDe(await m.casos.anularLinea(e.gerente, pedido))).toEqual({
      yaEstabaAnulada: true,
      totalProvisorio: { moneda: "ARS", monto: "0.00" },
    });
    // La repetición no cambia nada, ni el motivo guardado (aunque pida otro).
    expect(
      valorDe(await m.casos.anularLinea(e.gerente, { ...pedido, motivo: "Otro motivo" })),
    ).toMatchObject({ yaEstabaAnulada: true });
    expect(await sinCambios(e)).toEqual(antes);
    expect((await m.auditoria(e.empresa, "LINEA_ANULADA")).length).toBe(1);
    const guardada = await m.filas<{ motivo_de_anulacion: string }>(
      "select motivo_de_anulacion from linea_cuenta where id = $1",
      [linea],
    );
    expect(guardada[0]?.motivo_de_anulacion).toBe("Se equivocó el cliente");
    // También cuando la cuenta ya se anuló después: la línea ya estaba anulada.
    valorDe(await m.casos.anularCuenta(e.gerente, { cuentaId: cuenta, motivo: "Se fue" }));
    expect(valorDe(await m.casos.anularLinea(e.gerente, pedido))).toMatchObject({
      yaEstabaAnulada: true,
    });
  });

  it("I4: anular dos veces la misma cuenta es ok y no audita la segunda", async () => {
    const e = await m.escenario();
    const { cuenta } = await cuentaConLinea(m, e);
    const pedido = { cuentaId: cuenta, motivo: "El cliente se fue" };
    expect(valorDe(await m.casos.anularCuenta(e.gerente, pedido))).toEqual({
      yaEstabaAnulada: false,
    });
    const antes = await sinCambios(e);
    expect(valorDe(await m.casos.anularCuenta(e.gerente, pedido))).toEqual({
      yaEstabaAnulada: true,
    });
    expect(await sinCambios(e)).toEqual(antes);
    expect((await m.auditoria(e.empresa, "CUENTA_ANULADA")).length).toBe(1);
    expect((await cuentaEn(cuenta))?.estado).toBe("ANULADA");
  });

  it("I5: cerrar dos veces la misma cuenta deja un solo ticket y el mismo número", async () => {
    const e = await m.escenario();
    const { cuenta } = await cuentaConLinea(m, e);
    const ejemplarId = nuevoId();
    const primera = valorDe(
      await m.casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId }),
    );
    expect(primera).toMatchObject({ numero: 1, yaEstabaCerrada: false });
    const segunda = valorDe(
      await m.casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId }),
    );
    expect(segunda).toEqual({ ...primera, yaEstabaCerrada: true });
    // Con otro id de ejemplar (otro intento de la pantalla) devuelve el mismo ticket, con el ejemplar original que ya existe.
    const tercera = valorDe(await cerrar(e.gerente, cuenta));
    expect(tercera).toEqual({ ...primera, yaEstabaCerrada: true });
    expect(await contar("ticket", e.empresa)).toBe(1);
    expect(await contar("ticket_ejemplar", e.empresa)).toBe(1);
    expect(await numerador(e)).toBe(1);
    expect((await m.auditoria(e.empresa, "TICKET_EMITIDO")).length).toBe(1);
    expect((await m.auditoria(e.empresa, "CUENTA_CERRADA")).length).toBe(1);
    // Una cuenta anulada no se cierra: CUENTA_ANULADA, y no se numera.
    const { cuenta: anulada } = await cuentaConLinea(m, e);
    valorDe(await m.casos.anularCuenta(e.gerente, { cuentaId: anulada, motivo: "Se fue" }));
    expect(falla(await cerrar(e.gerente, anulada))).toBe("CUENTA_ANULADA");
    expect(await numerador(e)).toBe(1);
  });

  it("I6: repetir anularTicket con la misma clave anula una vez; con otra huella, CLAVE_REUTILIZADA", async () => {
    const e = await m.escenario();
    const t = await ticketDe(e);
    const pedido = {
      claveIdempotencia: nuevaClave(),
      ticketId: t.ticketId,
      ejemplarBaseId: t.ejemplarId,
      ejemplarNuevoId: nuevoId(),
      motivo: "Error del cajero",
    };
    const primera = valorDe(await m.casos.anularTicket(e.gerente, pedido));
    expect(primera).toMatchObject({ numero: 1, estado: "ANULADO", yaExistia: false });
    const repetida = valorDe(await m.casos.anularTicket(e.gerente, pedido));
    expect(repetida).toEqual({ ...primera, yaExistia: true });
    expect(await contar("ticket_ejemplar", e.empresa)).toBe(2);
    expect(await contar("ticket_correccion", e.empresa)).toBe(1);
    expect((await m.auditoria(e.empresa, "TICKET_ANULADO")).length).toBe(1);
    // La misma clave con otro motivo, otro ejemplar nuevo, otro ticket o un ejemplar base distinto: otra huella.
    for (const otro of [
      { motivo: "Otro motivo" },
      { ejemplarNuevoId: nuevoId() },
      { ejemplarBaseId: nuevoId() },
    ]) {
      expect(
        falla(await m.casos.anularTicket(e.gerente, { ...pedido, ...otro })),
        JSON.stringify(otro),
      ).toBe("CLAVE_REUTILIZADA");
    }
    const otroTicket = await ticketDe(e);
    expect(
      falla(
        await m.casos.anularTicket(e.gerente, {
          ...pedido,
          ticketId: otroTicket.ticketId,
          ejemplarBaseId: otroTicket.ejemplarId,
        }),
      ),
    ).toBe("CLAVE_REUTILIZADA");
    expect(await contar("ticket_correccion", e.empresa)).toBe(1);
    expect((await m.auditoria(e.empresa, "TICKET_ANULADO")).length).toBe(1);
  });

  // ---- flujo feliz ------------------------------------------------------------------------------------------------------------

  it("flujo feliz: la cuenta suma sus líneas, el cierre emite el ticket con su número, fecha, total y renglones", async () => {
    const e = await m.escenario();
    const cafe = await m.productoVendible(e.empresa, "1500.50");
    const cuenta = await abrir(e);
    expect((await cuentaEn(cuenta))?.total).toBe("0.00");
    const a = valorDe((await agregar(e.gerente, cuenta, e.producto, "2")).r);
    expect(a.totalProvisorio.monto).toBe("2000.00");
    const b = valorDe((await agregar(e.gerente, cuenta, cafe, "3")).r);
    expect(b).toMatchObject({ posicion: 2, totalProvisorio: { moneda: "ARS", monto: "6501.50" } });
    expect(await cuentaEn(cuenta)).toEqual({ estado: "ABIERTA", total: "6501.50", posicion: 2 });
    const t = valorDe(await cerrar(e.gerente, cuenta));
    expect(t).toMatchObject({
      numero: 1,
      numeroDeCorreccion: 0,
      estado: "EMITIDO",
      fechaNegocio: FECHA_DE_NEGOCIO,
      total: { moneda: "ARS", monto: "6501.50" },
      yaEstabaCerrada: false,
    });
    expect(await cuentaEn(cuenta)).toEqual({ estado: "CERRADA", total: "6501.50", posicion: 2 });
    expect(await renglones(t.ticketId)).toEqual(["2000.00", "4501.50"]);
    const ficha = valorDe(await m.consultas.fichaDeTicket(e.gerente, { ticketId: t.ticketId }));
    expect(ficha).toMatchObject({ numero: 1, estado: "EMITIDO", numeroDeCorreccion: 0 });
    // El siguiente ticket de la sucursal es el 2; el numerador es de la sucursal, no de la cuenta.
    expect(valorDe(await cerrar(e.gerente, (await cuentaConLinea(m, e)).cuenta))).toMatchObject({
      numero: 2,
    });
    expect(await numerador(e)).toBe(2);
    // Anular una línea baja el total; la anulada no entra al ticket.
    const otra = await abrir(e);
    const uno = await agregar(e.gerente, otra, e.producto, "1");
    valorDe(uno.r);
    const dos = await agregar(e.gerente, otra, cafe, "1");
    valorDe(dos.r);
    expect(
      valorDe(
        await m.casos.anularLinea(e.gerente, {
          cuentaId: otra,
          lineaId: uno.lineaId,
          motivo: "Error",
        }),
      ),
    ).toEqual({ yaEstabaAnulada: false, totalProvisorio: { moneda: "ARS", monto: "1500.50" } });
    const t3 = valorDe(await cerrar(e.gerente, otra));
    expect(t3).toMatchObject({ numero: 3, total: { monto: "1500.50" } });
    expect(await renglones(t3.ticketId)).toEqual(["1500.50"]);
  });

  // ---- precio, foto de opciones, cantidad -------------------------------------------------------------------------------------

  it("el precio y la foto de las opciones se congelan: precio_unitario = base + recargos, y un cambio posterior del catálogo no mueve la línea", async () => {
    const e = await m.escenario();
    const producto = await productoDeBase(m.dueno, e.empresa);
    const tamano = await m.grupoDeBase(e.empresa, producto, {
      clase: "VARIANTE",
      esTamano: true,
      nombre: "Tamaño",
    });
    const chico = await m.opcionDeBase(e.empresa, producto, tamano, { nombre: "Chico" });
    const extras = await m.grupoDeBase(e.empresa, producto, {
      clase: "ADICIONAL",
      nombre: "Extras",
      admiteVarias: true,
    });
    const leche = await m.opcionDeBase(e.empresa, producto, extras, {
      nombre: "Leche de almendras",
      recargo: "600",
    });
    const miel = await m.opcionDeBase(e.empresa, producto, extras, {
      nombre: "Miel",
      recargo: "150",
    });
    await m.precio({
      empresa: e.empresa,
      producto,
      opcion: chico.opcion,
      precio: "3000",
      desde: "2026-01-01T00:00:00Z",
    });
    const cuenta = await abrir(e);
    const { lineaId, r } = await agregar(e.gerente, cuenta, producto, "1", {
      varianteId: chico.opcion,
      opcionIds: [leche.opcion, miel.opcion],
    });
    expect(valorDe(r)).toMatchObject({
      posicion: 1,
      precioUnitario: { moneda: "ARS", monto: "3750.000000" },
      totalProvisorio: { monto: "3750.00" },
    });
    const linea = (await m.filas("select * from linea_cuenta where id = $1", [lineaId]))[0] as Fila;
    expect(linea).toMatchObject({
      variante_opcion_id: chico.opcion,
      variante_nombre: "Chico",
      origen_del_precio: "EMPRESA",
      alicuota: "21",
      unidad_de_venta: "UNIDAD",
      controla_stock: false,
      creada_por: e.gerente.personaId,
    });
    expect(linea["precio_base"]).toBe("3000.000000");
    expect(linea["precio_unitario"]).toBe("3750.000000");
    const fotos = await m.filas(
      `select orden, opcion_id, version_de_opcion_id, nombre_de_grupo, nombre, clase, recargo::text as recargo, origen_del_recargo
         from linea_cuenta_opcion where linea_id = $1 order by orden`,
      [lineaId],
    );
    expect(fotos.length).toBe(2);
    expect(
      fotos.map((f) => [f["nombre_de_grupo"], f["nombre"], f["clase"], f["recargo"]]).sort(),
    ).toEqual([
      ["Extras", "Leche de almendras", "ADICIONAL", "600.000000"],
      ["Extras", "Miel", "ADICIONAL", "150.000000"],
    ]);
    expect(fotos.map((f) => f["opcion_id"]).sort()).toEqual([leche.opcion, miel.opcion].sort());
    expect(fotos.map((f) => f["version_de_opcion_id"]).sort()).toEqual(
      [leche.version, miel.version].sort(),
    );
    // Cambian el precio de la variante (empresa y sucursal) y el recargo de la leche: la línea guardada no se entera.
    await m.precio({
      empresa: e.empresa,
      producto,
      opcion: chico.opcion,
      precio: "3500",
      desde: "2026-10-13T00:00:00Z",
    });
    await m.precio({
      empresa: e.empresa,
      producto,
      opcion: chico.opcion,
      sucursal: e.sucursal,
      precio: "3900",
      desde: "2026-10-13T00:00:00Z",
    });
    await m.dueno.query(
      `insert into version_de_opcion (id, empresa_id, opcion_id, numero, nombre, recargo, factor_de_tamano, creado_en)
       values ($1, $2, $3, 2, 'Leche de almendras', 900, 1, now())`,
      [nuevoId(), e.empresa, leche.opcion],
    );
    expect(await lineasDelPrimero(cuenta)).toEqual({
      base: "3000.000000",
      unitario: "3750.000000",
    });
    expect((await cuentaEn(cuenta))?.total).toBe("3750.00");
    // Una línea NUEVA sí toma lo nuevo (la sucursal manda sobre la empresa).
    const nueva = valorDe(
      (
        await agregar(e.gerente, cuenta, producto, "1", {
          varianteId: chico.opcion,
          opcionIds: [leche.opcion],
        })
      ).r,
    );
    expect(Number(nueva.precioUnitario.monto)).toBeGreaterThan(3900);
    // Y el ticket sale con lo congelado de la primera.
    const t = valorDe(await cerrar(e.gerente, cuenta));
    expect((await renglones(t.ticketId))[0]).toBe("3750.00");
  });

  const lineasDelPrimero = async (cuenta: string) => {
    const l = (await lineasDe(cuenta))[0] as Fila;
    return { base: l["base"], unitario: l["unitario"] };
  };

  it("cambiar el precio del catálogo después de agregar no cambia la línea ni el ticket (sin opciones)", async () => {
    const e = await m.escenario();
    const producto = await m.productoVendible(e.empresa, "1000");
    const cuenta = await abrir(e);
    valorDe((await agregar(e.gerente, cuenta, producto, "2")).r);
    await m.precio({
      empresa: e.empresa,
      producto,
      precio: "1200",
      desde: "2026-10-13T00:00:00Z",
    });
    expect(await lineasDelPrimero(cuenta)).toEqual({
      base: "1000.000000",
      unitario: "1000.000000",
    });
    const nueva = valorDe((await agregar(e.gerente, cuenta, producto, "1")).r);
    expect(nueva.precioUnitario.monto).toBe("1200.000000");
    expect(nueva.totalProvisorio.monto).toBe("3200.00");
    const t = valorDe(await cerrar(e.gerente, cuenta));
    expect(await renglones(t.ticketId)).toEqual(["2000.00", "1200.00"]);
  });

  it("la cantidad es decimal exacto y múltiplo del paso: con paso 0,5 pasan 0,5 y 1,5 y no 0,25; con paso 1 no pasa 0,5; cota 9999", async () => {
    const e = await m.escenario();
    const mitad = await m.productoVendible(e.empresa, "10", { paso: "0.5" });
    const cuenta = await abrir(e);
    for (const buena of ["0.5", "1.5", "2", "9999"]) {
      const { lineaId, r } = await agregar(e.gerente, cuenta, mitad, buena);
      expect(valorDe(r).posicion, buena).toBeGreaterThan(0);
      const guardada = (
        await m.filas<{ cantidad: string; paso: string }>(
          "select cantidad::text as cantidad, paso_de_cantidad::text as paso from linea_cuenta where id = $1",
          [lineaId],
        )
      )[0];
      expect(guardada?.paso).toBe("0.5000");
      expect(Number(guardada?.cantidad)).toBe(Number(buena));
    }
    const antes = await sinCambios(e);
    expect(falla((await agregar(e.gerente, cuenta, mitad, "0.25")).r)).toBe(
      "CANTIDAD_NO_ES_MULTIPLO_DEL_PASO",
    );
    expect(falla((await agregar(e.gerente, cuenta, e.producto, "0.5")).r)).toBe(
      "CANTIDAD_NO_ES_MULTIPLO_DEL_PASO",
    );
    expect(falla((await agregar(e.gerente, cuenta, e.producto, "1.5")).r)).toBe(
      "CANTIDAD_NO_ES_MULTIPLO_DEL_PASO",
    );
    // La cota de 9999 y lo que no es una cantidad.
    for (const mala of [
      "10000",
      "9999.5",
      "0",
      "0.0",
      "",
      " ",
      "-1",
      "-0.5",
      "abc",
      "1,5",
      "1e3",
      "NaN",
      "1.00001",
    ]) {
      expect(falla((await agregar(e.gerente, cuenta, mitad, mala)).r), JSON.stringify(mala)).toBe(
        "CANTIDAD_INVALIDA",
      );
    }
    // Nada de lo rechazado escribió.
    expect(await sinCambios(e)).toEqual(antes);
    expect((await cuentaEn(cuenta))?.posicion).toBe(4);
  });

  it("dos líneas de 0,5 × 9,95 totalizan 9,95 y el ticket reparte 4,98 y 4,97 (el redondeo es del grupo, no de cada línea)", async () => {
    const e = await m.escenario();
    const p = await m.productoVendible(e.empresa, "9.95", { paso: "0.5" });
    const cuenta = await abrir(e);
    expect(valorDe((await agregar(e.gerente, cuenta, p, "0.5")).r).totalProvisorio.monto).toBe(
      "4.98",
    );
    expect(valorDe((await agregar(e.gerente, cuenta, p, "0.5")).r).totalProvisorio.monto).toBe(
      "9.95",
    );
    expect((await cuentaEn(cuenta))?.total).toBe("9.95");
    const t = valorDe(await cerrar(e.gerente, cuenta));
    expect(t.total.monto).toBe("9.95");
    const r = await renglones(t.ticketId);
    expect(r).toEqual(["4.98", "4.97"]);
  });

  it("P3: tres líneas de 0,5 × 3,33 totalizan 5,00 y los renglones suman el total al centavo", async () => {
    const e = await m.escenario();
    const p = await m.productoVendible(e.empresa, "3.33", { paso: "0.5" });
    const cuenta = await abrir(e);
    for (let i = 0; i < 3; i += 1) valorDe((await agregar(e.gerente, cuenta, p, "0.5")).r);
    const t = valorDe(await cerrar(e.gerente, cuenta));
    expect(t.total.monto).toBe("5.00");
    const r = await renglones(t.ticketId);
    expect(r.length).toBe(3);
    const centavos = r.map((x) => BigInt(x.replace(".", "")));
    expect(centavos.reduce((a, b) => a + b, 0n)).toBe(500n);
    expect(r).toEqual(["1.67", "1.67", "1.66"]);
    // El total del grupo y del ejemplar son el del ticket (lo comprueba la base al confirmar; se ve también acá).
    const grupos = await m.filas<{ total: string }>(
      `select g.total::text as total from ejemplar_grupo g join ticket_ejemplar x on x.id = g.ejemplar_id where x.ticket_id = $1`,
      [t.ticketId],
    );
    expect(grupos).toEqual([{ total: "5.00" }]);
  });

  it("PRODUCTO_SIN_PRECIO: un producto de precio abierto sin importe escrito no se vende", async () => {
    const e = await m.escenario();
    const abierto = await m.productoVendible(e.empresa, null);
    const cuenta = await abrir(e);
    const antes = await sinCambios(e);
    expect(falla((await agregar(e.gerente, cuenta, abierto)).r)).toBe("PRODUCTO_SIN_PRECIO");
    expect(await sinCambios(e)).toEqual(antes);
  });

  it("un producto de otra empresa se comporta como inexistente", async () => {
    const e = await m.escenario();
    const ajeno = (await m.escenario()).producto;
    const cuenta = await abrir(e);
    expect(falla((await agregar(e.gerente, cuenta, ajeno)).r)).toBe("PRODUCTO_NO_ENCONTRADO");
    expect(falla((await agregar(e.gerente, cuenta, nuevoId())).r)).toBe("PRODUCTO_NO_ENCONTRADO");
  });

  // ---- cortesía ---------------------------------------------------------------------------------------------------------------

  it("línea a $0: CONFIRMACION_REQUERIDA sin la confirmación y ok con ella; otra confirmación es inválida", async () => {
    const e = await m.escenario();
    const gratis = await m.productoVendible(e.empresa, "0");
    const cuenta = await abrir(e);
    const antes = await sinCambios(e);
    expect(falla((await agregar(e.gerente, cuenta, gratis)).r)).toEqual({
      error: "CONFIRMACION_REQUERIDA",
      clave: "VENTA_A_CERO",
    });
    expect(
      falla((await agregar(e.gerente, cuenta, gratis, "1", { confirmaciones: [] })).r),
    ).toEqual({
      error: "CONFIRMACION_REQUERIDA",
      clave: "VENTA_A_CERO",
    });
    expect(
      falla((await agregar(e.gerente, cuenta, gratis, "1", { confirmaciones: ["OTRA"] })).r),
    ).toBe("CONFIRMACION_INVALIDA");
    expect(await sinCambios(e)).toEqual(antes);
    const r = valorDe(
      (await agregar(e.gerente, cuenta, gratis, "1", { confirmaciones: ["VENTA_A_CERO"] })).r,
    );
    expect(r).toMatchObject({
      posicion: 1,
      precioUnitario: { monto: "0.000000" },
      totalProvisorio: { monto: "0.00" },
    });
  });

  it("cerrar con total 0: CONFIRMACION_REQUERIDA y nada escrito (ni número consumido); con confirmación, ticket CORTESIA y CORTESIA_REGISTRADA", async () => {
    const e = await m.escenario();
    const gratis = await m.productoVendible(e.empresa, "0");
    const cuenta = await abrir(e);
    valorDe(
      (await agregar(e.gerente, cuenta, gratis, "1", { confirmaciones: ["VENTA_A_CERO"] })).r,
    );
    const antes = await sinCambios(e);
    expect(falla(await cerrar(e.gerente, cuenta))).toEqual({
      error: "CONFIRMACION_REQUERIDA",
      clave: "VENTA_A_CERO",
    });
    expect(await sinCambios(e)).toEqual(antes);
    expect((await cuentaEn(cuenta))?.estado).toBe("ABIERTA");
    expect(await numerador(e)).toBe(0);
    // El siguiente ticket toma el mismo número que habría tomado el rechazado: el 1.
    const t = valorDe(await cerrar(e.gerente, cuenta, { confirmaciones: ["VENTA_A_CERO"] }));
    expect(t).toMatchObject({ numero: 1, estado: "CORTESIA", total: { monto: "0.00" } });
    expect(await numerador(e)).toBe(1);
    const evento = await m.auditoria(e.empresa, "CORTESIA_REGISTRADA");
    expect(evento.length).toBe(1);
    expect(evento[0]).toMatchObject({
      entidad: "ticket",
      entidad_id: t.ticketId,
      actor_persona_id: e.gerente.personaId,
      despues: { tipo: "TOTAL", numero: 1 },
    });
    // Repetir el cierre devuelve el mismo ticket y no vuelve a registrar la cortesía.
    expect(valorDe(await cerrar(e.gerente, cuenta))).toMatchObject({
      numero: 1,
      yaEstabaCerrada: true,
    });
    expect((await m.auditoria(e.empresa, "CORTESIA_REGISTRADA")).length).toBe(1);
  });

  it("cortesía parcial: una línea a $0 dentro de un total mayor que 0 deja el ticket EMITIDO y registra CORTESIA_REGISTRADA PARCIAL", async () => {
    const e = await m.escenario();
    const gratis = await m.productoVendible(e.empresa, "0");
    const cuenta = await abrir(e);
    valorDe((await agregar(e.gerente, cuenta, e.producto)).r);
    const cero = await agregar(e.gerente, cuenta, gratis, "1", {
      confirmaciones: ["VENTA_A_CERO"],
    });
    valorDe(cero.r);
    // La confirmación se pidió al agregar la línea: cerrar no la vuelve a pedir.
    const t = valorDe(await cerrar(e.gerente, cuenta));
    expect(t).toMatchObject({ numero: 1, estado: "EMITIDO", total: { monto: "1000.00" } });
    expect(await renglones(t.ticketId)).toEqual(["1000.00", "0.00"]);
    const evento = await m.auditoria(e.empresa, "CORTESIA_REGISTRADA");
    expect(evento.length).toBe(1);
    expect(evento[0]).toMatchObject({ despues: { tipo: "PARCIAL", numero: 1 } });
    const lineas = (evento[0]?.["despues"] as { lineas: string[] }).lineas;
    expect(lineas).toEqual([cero.lineaId]);
  });

  // ---- estados y errores de cada comando --------------------------------------------------------------------------------------

  it("cerrar sin líneas vigentes es CUENTA_SIN_LINEAS (vacía, o con todas las líneas anuladas) y no escribe", async () => {
    const e = await m.escenario();
    const vacia = await abrir(e);
    const antes = await sinCambios(e);
    expect(falla(await cerrar(e.gerente, vacia))).toBe("CUENTA_SIN_LINEAS");
    const { cuenta, linea } = await cuentaConLinea(m, e);
    valorDe(
      await m.casos.anularLinea(e.gerente, { cuentaId: cuenta, lineaId: linea, motivo: "Error" }),
    );
    const medio = await sinCambios(e);
    expect(falla(await cerrar(e.gerente, cuenta))).toBe("CUENTA_SIN_LINEAS");
    expect(await sinCambios(e)).toEqual(medio);
    expect(antes.tickets).toBe(0);
    expect(await numerador(e)).toBe(0);
  });

  it("R5 y P11: una cuenta con todas las líneas anuladas se anula sin gastar número", async () => {
    const e = await m.escenario();
    const ancla = { tipo: "salon.mesa", id: nuevoId() };
    const cuenta = nuevoId();
    valorDe(
      await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal, ancla }),
    );
    const a = await agregar(e.gerente, cuenta, e.producto);
    const b = await agregar(e.gerente, cuenta, e.producto);
    for (const l of [a, b]) {
      valorDe(l.r);
      valorDe(
        await m.casos.anularLinea(e.gerente, {
          cuentaId: cuenta,
          lineaId: l.lineaId,
          motivo: "Error",
        }),
      );
    }
    expect((await cuentaEn(cuenta))?.total).toBe("0.00");
    expect(
      valorDe(await m.casos.anularCuenta(e.gerente, { cuentaId: cuenta, motivo: "Sin consumo" })),
    ).toEqual({
      yaEstabaAnulada: false,
    });
    expect(await numerador(e)).toBe(0);
    expect(await contar("ticket", e.empresa)).toBe(0);
    // El ancla quedó libre: abrir otra cuenta con la misma ancla da una cuenta nueva.
    const otra = nuevoId();
    expect(
      valorDe(
        await m.casos.abrirCuenta(e.gerente, { cuentaId: otra, sucursalId: e.sucursal, ancla }),
      ),
    ).toEqual({ cuentaId: otra, yaExistia: false });
  });

  it("agregar a una cuenta cerrada o anulada es CUENTA_NO_ABIERTA; anular una cuenta cerrada es CUENTA_CERRADA; y no escriben", async () => {
    const e = await m.escenario();
    const cerrada = await ticketDe(e);
    const { cuenta: anulada } = await cuentaConLinea(m, e);
    valorDe(await m.casos.anularCuenta(e.gerente, { cuentaId: anulada, motivo: "Se fue" }));
    const antes = await sinCambios(e);
    expect(falla((await agregar(e.gerente, cerrada.cuenta, e.producto)).r)).toBe(
      "CUENTA_NO_ABIERTA",
    );
    expect(falla((await agregar(e.gerente, anulada, e.producto)).r)).toBe("CUENTA_NO_ABIERTA");
    expect(
      falla(await m.casos.anularCuenta(e.gerente, { cuentaId: cerrada.cuenta, motivo: "Error" })),
    ).toBe("CUENTA_CERRADA");
    // Anular una línea vigente de una cuenta resuelta tampoco: la cuenta ya no está abierta.
    const linea = (
      await m.filas<{ id: string }>("select id from linea_cuenta where cuenta_id = $1", [
        cerrada.cuenta,
      ])
    )[0]?.id as string;
    expect(
      falla(
        await m.casos.anularLinea(e.gerente, {
          cuentaId: cerrada.cuenta,
          lineaId: linea,
          motivo: "Error",
        }),
      ),
    ).toBe("CUENTA_NO_ABIERTA");
    expect(await sinCambios(e)).toEqual(antes);
  });

  it("anularLinea de una línea ajena a la cuenta o inexistente es LINEA_NO_ENCONTRADA; una cuenta inexistente, CUENTA_NO_ENCONTRADA", async () => {
    const e = await m.escenario();
    const una = await cuentaConLinea(m, e);
    const otra = await cuentaConLinea(m, e);
    const antes = await sinCambios(e);
    expect(
      falla(
        await m.casos.anularLinea(e.gerente, {
          cuentaId: otra.cuenta,
          lineaId: una.linea,
          motivo: "Error",
        }),
      ),
    ).toBe("LINEA_NO_ENCONTRADA");
    expect(
      falla(
        await m.casos.anularLinea(e.gerente, {
          cuentaId: otra.cuenta,
          lineaId: nuevoId(),
          motivo: "Error",
        }),
      ),
    ).toBe("LINEA_NO_ENCONTRADA");
    expect(
      falla(
        await m.casos.anularLinea(e.gerente, {
          cuentaId: nuevoId(),
          lineaId: una.linea,
          motivo: "Error",
        }),
      ),
    ).toBe("CUENTA_NO_ENCONTRADA");
    expect(
      falla(await m.casos.anularCuenta(e.gerente, { cuentaId: nuevoId(), motivo: "Error" })),
    ).toBe("CUENTA_NO_ENCONTRADA");
    expect(falla(await cerrar(e.gerente, nuevoId()))).toBe("CUENTA_NO_ENCONTRADA");
    expect(falla((await agregar(e.gerente, nuevoId(), e.producto)).r)).toBe("CUENTA_NO_ENCONTRADA");
    expect(await sinCambios(e)).toEqual(antes);
  });

  it("un identificador que no es un uuid es IDENTIFICADOR_INVALIDO en cada comando, sin tocar la base", async () => {
    const e = await m.escenario();
    const { cuenta, linea } = await cuentaConLinea(m, e);
    const t = await ticketDe(e);
    const antes = await sinCambios(e);
    expect(
      falla(await m.casos.abrirCuenta(e.gerente, { cuentaId: "x", sucursalId: e.sucursal })),
    ).toBe("IDENTIFICADOR_INVALIDO");
    expect(
      falla(await m.casos.abrirCuenta(e.gerente, { cuentaId: nuevoId(), sucursalId: "x" })),
    ).toBe("IDENTIFICADOR_INVALIDO");
    expect(falla((await agregar(e.gerente, cuenta, "x")).r)).toBe("IDENTIFICADOR_INVALIDO");
    expect(
      falla(
        await m.casos.agregarLinea(e.gerente, {
          cuentaId: cuenta,
          lineaId: "x",
          productoId: e.producto,
          opcionIds: [],
          cantidad: "1",
        }),
      ),
    ).toBe("IDENTIFICADOR_INVALIDO");
    expect(
      falla(
        await m.casos.anularLinea(e.gerente, {
          cuentaId: cuenta,
          lineaId: `${linea}x`,
          motivo: "Error",
        }),
      ),
    ).toBe("IDENTIFICADOR_INVALIDO");
    expect(falla(await m.casos.anularCuenta(e.gerente, { cuentaId: "x", motivo: "Error" }))).toBe(
      "IDENTIFICADOR_INVALIDO",
    );
    expect(
      falla(await m.casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId: "x" })),
    ).toBe("IDENTIFICADOR_INVALIDO");
    expect(falla(await anularTicket(e.gerente, { ticketId: "x", ejemplarId: t.ejemplarId }))).toBe(
      "IDENTIFICADOR_INVALIDO",
    );
    expect(await sinCambios(e)).toEqual(antes);
  });

  it("MOTIVO_OBLIGATORIO y MOTIVO_INVALIDO (HTML, saltos de línea, largo) en las tres anulaciones, y no escriben", async () => {
    const e = await m.escenario();
    const { cuenta, linea } = await cuentaConLinea(m, e);
    const t = await ticketDe(e);
    const antes = await sinCambios(e);
    const motivos: [string, string][] = [
      ["", "MOTIVO_OBLIGATORIO"],
      ["   ", "MOTIVO_OBLIGATORIO"],
      ["<b>error</b>", "MOTIVO_INVALIDO"],
      ["<script>alert(1)</script>", "MOTIVO_INVALIDO"],
      ["primera línea\nsegunda línea", "MOTIVO_INVALIDO"],
      ["con\rretorno", "MOTIVO_INVALIDO"],
      ["con\ttabulación", "MOTIVO_INVALIDO"],
      ["x".repeat(501), "MOTIVO_INVALIDO"],
      ["con ‮ invisible", "MOTIVO_INVALIDO"],
    ];
    for (const [motivo, esperado] of motivos) {
      const rotulo = JSON.stringify(motivo.slice(0, 20));
      expect(
        falla(await m.casos.anularLinea(e.gerente, { cuentaId: cuenta, lineaId: linea, motivo })),
        rotulo,
      ).toBe(esperado);
      expect(
        falla(await m.casos.anularCuenta(e.gerente, { cuentaId: cuenta, motivo })),
        rotulo,
      ).toBe(esperado);
      expect(falla(await anularTicket(e.gerente, t, { motivo })), rotulo).toBe(esperado);
    }
    expect(await sinCambios(e)).toEqual(antes);
    // El largo máximo (500) es válido.
    valorDe(
      await m.casos.anularLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: linea,
        motivo: "x".repeat(500),
      }),
    );
  });

  it("ancla: dos cuentas con la misma ancla devuelven la existente; al resolver la primera la ancla queda libre; ANCLA_INVALIDA", async () => {
    const e = await m.escenario();
    const ancla = { tipo: "salon.mesa", id: nuevoId() };
    const primera = nuevoId();
    expect(
      valorDe(
        await m.casos.abrirCuenta(e.gerente, { cuentaId: primera, sucursalId: e.sucursal, ancla }),
      ),
    ).toEqual({ cuentaId: primera, yaExistia: false });
    const segunda = nuevoId();
    expect(
      valorDe(
        await m.casos.abrirCuenta(e.gerente, { cuentaId: segunda, sucursalId: e.sucursal, ancla }),
      ),
    ).toEqual({ cuentaId: primera, yaExistia: true });
    expect(await contar("cuenta_consumo", e.empresa)).toBe(1);
    // Otra ancla (otro id o otro tipo) es otra cuenta.
    const distinta = nuevoId();
    valorDe(
      await m.casos.abrirCuenta(e.gerente, {
        cuentaId: distinta,
        sucursalId: e.sucursal,
        ancla: { tipo: "salon.barra", id: ancla.id },
      }),
    );
    expect(await contar("cuenta_consumo", e.empresa)).toBe(2);
    // Resolver la primera (cerrándola) libera la ancla: la próxima apertura es una cuenta nueva.
    valorDe((await agregar(e.gerente, primera, e.producto)).r);
    valorDe(await cerrar(e.gerente, primera));
    const tercera = nuevoId();
    expect(
      valorDe(
        await m.casos.abrirCuenta(e.gerente, { cuentaId: tercera, sucursalId: e.sucursal, ancla }),
      ),
    ).toEqual({ cuentaId: tercera, yaExistia: false });
    // Y anularla también.
    valorDe(await m.casos.anularCuenta(e.gerente, { cuentaId: tercera, motivo: "Se fue" }));
    const cuarta = nuevoId();
    expect(
      valorDe(
        await m.casos.abrirCuenta(e.gerente, { cuentaId: cuarta, sucursalId: e.sucursal, ancla }),
      ),
    ).toEqual({ cuentaId: cuarta, yaExistia: false });
    // Ancla inválida: tipo con mayúsculas, vacío, con caracteres raros, demasiado largo, o id que no es uuid.
    const antes = await sinCambios(e);
    for (const mala of [
      { tipo: "Salon.Mesa", id: nuevoId() },
      { tipo: "", id: nuevoId() },
      { tipo: "salon mesa", id: nuevoId() },
      { tipo: "salon.mesa.x", id: nuevoId() },
      { tipo: "a".repeat(41), id: nuevoId() },
      { tipo: "salon.mesa", id: "no-es-uuid" },
      { tipo: "<b>", id: nuevoId() },
    ]) {
      expect(
        falla(
          await m.casos.abrirCuenta(e.gerente, {
            cuentaId: nuevoId(),
            sucursalId: e.sucursal,
            ancla: mala,
          }),
        ),
        JSON.stringify(mala),
      ).toBe("ANCLA_INVALIDA");
    }
    expect(await sinCambios(e)).toEqual(antes);
  });

  it("etiqueta inválida: ETIQUETA_INVALIDA, sin escribir; una válida se guarda", async () => {
    const e = await m.escenario();
    const antes = await sinCambios(e);
    for (const mala of ["<b>Mesa</b>", "Mesa\n4", "x".repeat(41), "Mesa‮4", "\u0000"]) {
      expect(
        falla(
          await m.casos.abrirCuenta(e.gerente, {
            cuentaId: nuevoId(),
            sucursalId: e.sucursal,
            etiqueta: mala,
          }),
        ),
        JSON.stringify(mala),
      ).toBe("ETIQUETA_INVALIDA");
    }
    expect(await sinCambios(e)).toEqual(antes);
    const id = nuevoId();
    valorDe(
      await m.casos.abrirCuenta(e.gerente, {
        cuentaId: id,
        sucursalId: e.sucursal,
        etiqueta: "Mesa 4 - Juan",
      }),
    );
    expect(
      (
        await m.filas<{ etiqueta: string }>("select etiqueta from cuenta_consumo where id = $1", [
          id,
        ])
      )[0]?.etiqueta,
    ).toBe("Mesa 4 - Juan");
  });

  it("sucursal inexistente (o de otra empresa) e inactiva: SUCURSAL_FUERA_DE_ALCANCE o SUCURSAL_NO_ENCONTRADA / SUCURSAL_INACTIVA", async () => {
    const e = await m.escenario();
    const otraEmpresa = await m.escenario();
    const antes = await sinCambios(e);
    // El gerente tiene todas las sucursales: una inexistente o ajena no está en la empresa.
    expect(
      falla(await m.casos.abrirCuenta(e.gerente, { cuentaId: nuevoId(), sucursalId: nuevoId() })),
    ).toBe("SUCURSAL_NO_ENCONTRADA");
    expect(
      falla(
        await m.casos.abrirCuenta(e.gerente, {
          cuentaId: nuevoId(),
          sucursalId: otraEmpresa.sucursal,
        }),
      ),
    ).toBe("SUCURSAL_NO_ENCONTRADA");
    await m.dueno.query("update sucursal set activa = false where id = $1", [e.otraSucursal]);
    expect(
      falla(
        await m.casos.abrirCuenta(e.gerente, { cuentaId: nuevoId(), sucursalId: e.otraSucursal }),
      ),
    ).toBe("SUCURSAL_INACTIVA");
    expect(await sinCambios(e)).toEqual(antes);
    // La sucursal activa sigue abriendo.
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: nuevoId(), sucursalId: e.sucursal }));
  });

  it("una sucursal desactivada después de abrir la cuenta no deja agregar líneas (el catálogo no cotiza en una sucursal inactiva)", async () => {
    const e = await m.escenario();
    const cuenta = await abrir(e, e.gerente, e.otraSucursal);
    await m.dueno.query("update sucursal set activa = false where id = $1", [e.otraSucursal]);
    const antes = await sinCambios(e);
    expect(falla((await agregar(e.gerente, cuenta, e.producto)).r)).toBe("SUCURSAL_INACTIVA");
    expect(await sinCambios(e)).toEqual(antes);
    // Anular sigue permitido: es la salida de la cuenta.
    valorDe(
      await m.casos.anularCuenta(e.gerente, { cuentaId: cuenta, motivo: "Sucursal cerrada" }),
    );
  });

  // ---- anularTicket -----------------------------------------------------------------------------------------------------------

  it("anularTicket sobre un ticket EMITIDO: queda ANULADO, conserva su número, numeroDeCorreccion = 1 y el numerador no avanza", async () => {
    const e = await m.escenario();
    const t = await ticketDe(e);
    const t2 = await ticketDe(e);
    expect(t2.numero).toBe(2);
    const anulado = valorDe(await anularTicket(e.gerente, t));
    expect(anulado).toMatchObject({
      ticketId: t.ticketId,
      numero: 1,
      estado: "ANULADO",
      numeroDeCorreccion: 1,
      yaExistia: false,
    });
    expect(await numerador(e)).toBe(2);
    const fila = (
      await m.filas<Fila>(
        "select numero, estado, ejemplar_vigente, total::text as total, fecha_negocio::text as fecha from ticket where id = $1",
        [t.ticketId],
      )
    )[0];
    expect(fila).toEqual({
      numero: 1,
      estado: "ANULADO",
      ejemplar_vigente: 2,
      total: "1000.00",
      fecha: FECHA_DE_NEGOCIO,
    });
    const ejemplares = await m.filas<Fila>(
      "select numero_de_ejemplar as n, tipo, total::text as total, ejemplar_base_id as base from ticket_ejemplar where ticket_id = $1 order by numero_de_ejemplar",
      [t.ticketId],
    );
    expect(ejemplares).toEqual([
      { n: 1, tipo: "ORIGINAL", total: "1000.00", base: null },
      { n: 2, tipo: "ANULACION", total: "0.00", base: t.ejemplarId },
    ]);
    const correccion = (
      await m.filas<Fila>(
        "select tipo, motivo, hecha_por, fecha_negocio::text as fecha, ejemplar_nuevo_id from ticket_correccion where ticket_id = $1",
        [t.ticketId],
      )
    )[0];
    expect(correccion).toEqual({
      tipo: "ANULACION",
      motivo: "Error del cajero",
      hecha_por: e.gerente.personaId,
      fecha: FECHA_DE_NEGOCIO,
      ejemplar_nuevo_id: anulado.ejemplarNuevoId,
    });
    // El original conserva sus renglones; el de anulación no lleva ninguno. La cuenta sigue cerrada.
    expect(await renglones(t.ticketId)).toEqual(["1000.00"]);
    expect((await cuentaEn(t.cuenta))?.estado).toBe("CERRADA");
    const ficha = valorDe(await m.consultas.fichaDeTicket(e.gerente, { ticketId: t.ticketId }));
    expect(ficha).toMatchObject({ numero: 1, estado: "ANULADO", numeroDeCorreccion: 1 });
    expect(ficha.ejemplares.map((x) => [x.tipo, x.vigente])).toEqual([
      ["ANULACION", true],
      ["ORIGINAL", false],
    ]);
    // El otro ticket no cambió y el próximo número es el 3: un anulado conserva su número, no lo libera.
    expect(valorDe(await ticketDe(e).then((x) => ({ ok: true as const, valor: x.numero })))).toBe(
      3,
    );
  });

  it("anularTicket sobre una CORTESIA la anula también", async () => {
    const e = await m.escenario();
    const gratis = await m.productoVendible(e.empresa, "0");
    const cuenta = await abrir(e);
    valorDe(
      (await agregar(e.gerente, cuenta, gratis, "1", { confirmaciones: ["VENTA_A_CERO"] })).r,
    );
    const t = valorDe(await cerrar(e.gerente, cuenta, { confirmaciones: ["VENTA_A_CERO"] }));
    expect(t.estado).toBe("CORTESIA");
    expect(valorDe(await anularTicket(e.gerente, t))).toMatchObject({
      estado: "ANULADO",
      numero: 1,
    });
    expect(
      (
        await m.filas<{ estado: string; total: string }>(
          "select estado, total::text as total from ticket where id = $1",
          [t.ticketId],
        )
      )[0],
    ).toEqual({ estado: "ANULADO", total: "0.00" });
  });

  it("anularTicket: EJEMPLAR_DESACTUALIZADO, TICKET_ANULADO con otra clave, CLAVE_INVALIDA, TICKET_NO_ENCONTRADO; y no escriben", async () => {
    const e = await m.escenario();
    const t = await ticketDe(e);
    const antes = await sinCambios(e);
    expect(falla(await anularTicket(e.gerente, t, { ejemplarBaseId: nuevoId() }))).toBe(
      "EJEMPLAR_DESACTUALIZADO",
    );
    for (const mala of [
      "corta",
      "",
      "con espacio 1234567890",
      "con/barra/1234567890",
      "x".repeat(129),
      "ñ".repeat(20),
    ]) {
      expect(
        falla(await anularTicket(e.gerente, t, { claveIdempotencia: mala })),
        JSON.stringify(mala),
      ).toBe("CLAVE_INVALIDA");
    }
    expect(
      falla(await anularTicket(e.gerente, { ticketId: nuevoId(), ejemplarId: t.ejemplarId })),
    ).toBe("TICKET_NO_ENCONTRADO");
    expect(await sinCambios(e)).toEqual(antes);
    valorDe(await anularTicket(e.gerente, t));
    // Ya anulado, con otra clave (y cualquier ejemplar base): TICKET_ANULADO.
    expect(falla(await anularTicket(e.gerente, t))).toBe("TICKET_ANULADO");
    expect(
      falla(await anularTicket(e.gerente, { ticketId: t.ticketId, ejemplarId: nuevoId() })),
    ).toBe("TICKET_ANULADO");
    expect(await contar("ticket_correccion", e.empresa)).toBe(1);
    expect(await contar("ticket_ejemplar", e.empresa)).toBe(2);
  });

  it("la anulación se fecha en la jornada en que se hace (por reloj), no en la del ticket", async () => {
    const e = await m.escenario();
    const t = await ticketDe(e);
    const mañana = en(e.gerente, "2026-11-10T15:00:00Z");
    valorDe(await anularTicket(mañana, t));
    const fila = (
      await m.filas<{ fecha: string }>(
        "select fecha_negocio::text as fecha from ticket_correccion where ticket_id = $1",
        [t.ticketId],
      )
    )[0];
    expect(fila?.fecha).toBe("2026-11-10");
    expect(
      (
        await m.filas<{ fecha: string }>(
          "select fecha_negocio::text as fecha from ticket where id = $1",
          [t.ticketId],
        )
      )[0]?.fecha,
    ).toBe(FECHA_DE_NEGOCIO);
  });

  // ---- fecha de negocio por reloj (P17) ---------------------------------------------------------------------------------------

  it("P17: 01:25 con corte 06:00 es el día anterior; con corte 00:00 es el día del reloj; cambiar el corte no reescribe tickets", async () => {
    const e = await m.escenario();
    const madrugada = en(e.gerente, "2026-11-10T04:25:00Z"); // 01:25 en Argentina
    await m.dueno.query("update sucursal set hora_de_corte = '06:00' where id = $1", [e.sucursal]);
    const primero = await ticketDe({ ...e, gerente: madrugada }, madrugada);
    expect(primero.fechaNegocio).toBe("2026-11-09");
    // A las 06:00 en punto empieza el día nuevo.
    const seis = en(e.gerente, "2026-11-10T09:00:00Z");
    expect((await ticketDe(e, seis)).fechaNegocio).toBe("2026-11-10");
    const cincoCincuentaYNueve = en(e.gerente, "2026-11-10T08:59:00Z");
    expect((await ticketDe(e, cincoCincuentaYNueve)).fechaNegocio).toBe("2026-11-09");
    await m.dueno.query("update sucursal set hora_de_corte = '00:00' where id = $1", [e.sucursal]);
    const segundo = await ticketDe(e, madrugada);
    expect(segundo.fechaNegocio).toBe("2026-11-10");
    // El primer ticket no se reescribió.
    const guardada = await m.filas<{ numero: number; fecha: string }>(
      "select numero, fecha_negocio::text as fecha from ticket where empresa_id = $1 order by numero",
      [e.empresa],
    );
    expect(guardada.map((f) => f.fecha)).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-09",
      "2026-11-10",
    ]);
  });

  // ---- auditoría --------------------------------------------------------------------------------------------------------------

  it("cada comando escribe su evento de auditoría con quién lo hizo", async () => {
    const e = await m.escenario();
    const cuenta = nuevoId();
    valorDe(
      await m.casos.abrirCuenta(e.gerente, {
        cuentaId: cuenta,
        sucursalId: e.sucursal,
        etiqueta: "Mesa 1",
      }),
    );
    const a = await agregar(e.gerente, cuenta, e.producto, "2");
    valorDe(a.r);
    const b = await agregar(e.gerente, cuenta, e.producto, "1");
    valorDe(b.r);
    valorDe(
      await m.casos.anularLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: b.lineaId,
        motivo: "Error de carga",
      }),
    );
    const t = valorDe(await cerrar(e.gerente, cuenta));
    const otra = await abrir(e, e.administrador);
    valorDe(await m.casos.anularCuenta(e.administrador, { cuentaId: otra, motivo: "Se fue" }));
    valorDe(await anularTicket(e.operador, t, { motivo: "Se cobró mal" }));

    const unico = async (accion: string) => {
      const filas = await m.auditoria(e.empresa, accion);
      expect(filas.length, accion).toBeGreaterThan(0);
      return filas;
    };
    const abierta = await unico("CUENTA_ABIERTA");
    expect(abierta.length).toBe(2);
    expect(abierta[0]).toMatchObject({
      actor_persona_id: e.gerente.personaId,
      entidad: "cuenta_consumo",
      entidad_id: cuenta,
      despues: { sucursalId: e.sucursal, etiqueta: "Mesa 1", anclaTipo: null, anclaId: null },
    });
    expect(abierta[1]?.["actor_persona_id"]).toBe(e.administrador.personaId);
    const agregadas = await unico("LINEA_AGREGADA");
    expect(agregadas.length).toBe(2);
    expect(agregadas[0]).toMatchObject({
      actor_persona_id: e.gerente.personaId,
      entidad: "linea_cuenta",
      entidad_id: a.lineaId,
      despues: { cuentaId: cuenta, posicion: 1, cantidad: "2.0000", totalProvisorio: "2000.00" },
    });
    expect(await unico("LINEA_ANULADA")).toMatchObject([
      {
        actor_persona_id: e.gerente.personaId,
        entidad: "linea_cuenta",
        entidad_id: b.lineaId,
        despues: { estado: "ANULADA", motivo: "Error de carga", totalProvisorio: "2000.00" },
      },
    ]);
    expect(await unico("CUENTA_CERRADA")).toMatchObject([
      {
        actor_persona_id: e.gerente.personaId,
        entidad: "cuenta_consumo",
        entidad_id: cuenta,
        despues: { estado: "CERRADA", total: "2000.00", ticketId: t.ticketId },
      },
    ]);
    expect(await unico("TICKET_EMITIDO")).toMatchObject([
      {
        actor_persona_id: e.gerente.personaId,
        entidad: "ticket",
        entidad_id: t.ticketId,
        despues: { numero: 1, estado: "EMITIDO", total: "2000.00", cuentaId: cuenta },
      },
    ]);
    expect(await unico("CUENTA_ANULADA")).toMatchObject([
      {
        actor_persona_id: e.administrador.personaId,
        entidad: "cuenta_consumo",
        entidad_id: otra,
        despues: { estado: "ANULADA", motivo: "Se fue" },
      },
    ]);
    expect(await unico("TICKET_ANULADO")).toMatchObject([
      {
        actor_persona_id: e.operador.personaId,
        entidad: "ticket",
        entidad_id: t.ticketId,
        despues: { estado: "ANULADO", motivo: "Se cobró mal", numero: 1 },
      },
    ]);
    // La auditoría no guarda nada que se pueda leer como un secreto: es JSON de datos de negocio.
    expect(JSON.stringify(await m.auditoria(e.empresa))).not.toMatch(
      /token|clave_de_acceso|password/i,
    );
  });

  // ---- autorización y alcance (P15) -------------------------------------------------------------------------------------------

  it("P15: el operador sin asignación a la sucursal recibe SUCURSAL_FUERA_DE_ALCANCE en cada comando y no se escribe nada", async () => {
    const e = await m.escenario();
    // El gerente arma, en la otra sucursal, lo que el operador (asignado solo a la principal) va a intentar tocar.
    const cuenta = await abrir(e, e.gerente, e.otraSucursal);
    const linea = await agregar(e.gerente, cuenta, e.producto);
    valorDe(linea.r);
    const porCerrar = await abrir(e, e.gerente, e.otraSucursal);
    valorDe((await agregar(e.gerente, porCerrar, e.producto)).r);
    const cerradaAjena = await abrir(e, e.gerente, e.otraSucursal);
    valorDe((await agregar(e.gerente, cerradaAjena, e.producto)).r);
    const ticket = valorDe(await cerrar(e.gerente, cerradaAjena));
    const antes = await sinCambios(e);
    const o = e.operador;
    expect(
      falla(await m.casos.abrirCuenta(o, { cuentaId: nuevoId(), sucursalId: e.otraSucursal })),
    ).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    expect(falla((await agregar(o, cuenta, e.producto)).r)).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    expect(
      falla(
        await m.casos.anularLinea(o, { cuentaId: cuenta, lineaId: linea.lineaId, motivo: "Error" }),
      ),
    ).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    expect(falla(await m.casos.anularCuenta(o, { cuentaId: cuenta, motivo: "Error" }))).toBe(
      "SUCURSAL_FUERA_DE_ALCANCE",
    );
    expect(falla(await cerrar(o, porCerrar))).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    expect(falla(await anularTicket(o, ticket))).toBe("SUCURSAL_FUERA_DE_ALCANCE");
    expect(falla(await m.consultas.fichaDeTicket(o, { ticketId: ticket.ticketId }))).toBe(
      "SUCURSAL_FUERA_DE_ALCANCE",
    );
    expect(await sinCambios(e)).toEqual(antes);
    // En su sucursal, sí.
    valorDe(await m.casos.abrirCuenta(o, { cuentaId: nuevoId(), sucursalId: e.sucursal }));
  });

  it("P15: sin persona, o con una persona sin rol en la empresa, ningún comando pasa y no se escribe nada", async () => {
    const e = await m.escenario();
    const { cuenta, linea } = await cuentaConLinea(m, e);
    const t = await ticketDe(e);
    const sinMembresia = (await crearPersonaDeBase(m.dueno)).id;
    const antes = await sinCambios(e);
    const motivosPosibles = ["SIN_PERMISO", "MODULO_NO_ACTIVO"];
    for (const [nombre, contexto] of [
      ["sin persona", { ...e.gerente, personaId: null }],
      [
        "sin membresía",
        { ...e.gerente, personaId: sinMembresia as unknown as typeof e.gerente.personaId },
      ],
    ] as const) {
      const rechazos = [
        await m.casos.abrirCuenta(contexto, { cuentaId: nuevoId(), sucursalId: e.sucursal }),
        (await agregar(contexto, cuenta, e.producto)).r,
        await m.casos.anularLinea(contexto, { cuentaId: cuenta, lineaId: linea, motivo: "Error" }),
        await m.casos.anularCuenta(contexto, { cuentaId: cuenta, motivo: "Error" }),
        await cerrar(contexto, cuenta),
        await anularTicket(contexto, t),
      ];
      for (const r of rechazos) {
        expect(motivosPosibles, nombre).toContain(falla(r));
      }
    }
    expect(await sinCambios(e)).toEqual(antes);
  });

  it("P15: con las reglas reales el módulo ventas está en desarrollo: ningún comando pasa (MODULO_EN_DESARROLLO)", async () => {
    const e = await m.escenario();
    const { cuenta, linea } = await cuentaConLinea(m, e);
    const t = await ticketDe(e);
    const reales = crearCasosDeUsoDeVentas({
      transacciones: m.entorno,
      reglas: { catalogo: CATALOGO_DE_MODULOS, permisos: PERMISOS_DE_EMPRESA },
    });
    const antes = await sinCambios(e);
    const c = e.gerente;
    const rechazos = [
      await reales.abrirCuenta(c, { cuentaId: nuevoId(), sucursalId: e.sucursal }),
      await reales.agregarLinea(c, {
        cuentaId: cuenta,
        lineaId: nuevoId(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
      await reales.anularLinea(c, { cuentaId: cuenta, lineaId: linea, motivo: "Error" }),
      await reales.anularCuenta(c, { cuentaId: cuenta, motivo: "Error" }),
      await reales.cerrarCuenta(c, { cuentaId: cuenta, ejemplarId: nuevoId() }),
      await reales.anularTicket(c, {
        claveIdempotencia: nuevaClave(),
        ticketId: t.ticketId,
        ejemplarBaseId: t.ejemplarId,
        ejemplarNuevoId: nuevoId(),
        motivo: "Error",
      }),
    ];
    for (const r of rechazos) expect(falla(r)).toBe("MODULO_EN_DESARROLLO");
    expect(await sinCambios(e)).toEqual(antes);
  });

  it("P15: con ventas disponible pero NO activado en la empresa, ningún comando pasa (MODULO_NO_ACTIVO)", async () => {
    const e = await m.escenario();
    const { cuenta, linea } = await cuentaConLinea(m, e);
    const t = await ticketDe(e);
    // Un entorno SIN el ajuste del apoyo: los módulos activados salen de la base, y esta empresa no activó ventas.
    const llano = crearEntornoDePrueba(m.propia.base, 4);
    try {
      const casos = crearCasosDeUsoDeVentas({ transacciones: llano, reglas: REGLAS });
      const antes = await sinCambios(e);
      const c = e.gerente;
      const rechazos = [
        await casos.abrirCuenta(c, { cuentaId: nuevoId(), sucursalId: e.sucursal }),
        await casos.agregarLinea(c, {
          cuentaId: cuenta,
          lineaId: nuevoId(),
          productoId: e.producto,
          opcionIds: [],
          cantidad: "1",
        }),
        await casos.anularLinea(c, { cuentaId: cuenta, lineaId: linea, motivo: "Error" }),
        await casos.anularCuenta(c, { cuentaId: cuenta, motivo: "Error" }),
        await casos.cerrarCuenta(c, { cuentaId: cuenta, ejemplarId: nuevoId() }),
        await casos.anularTicket(c, {
          claveIdempotencia: nuevaClave(),
          ticketId: t.ticketId,
          ejemplarBaseId: t.ejemplarId,
          ejemplarNuevoId: nuevoId(),
          motivo: "Error",
        }),
      ];
      for (const r of rechazos) expect(falla(r)).toBe("MODULO_NO_ACTIVO");
      expect(await sinCambios(e)).toEqual(antes);
    } finally {
      await llano.cerrar();
    }
  });

  it("decisión 155: el operador puede abrir, cargar, anular líneas y cuentas, cerrar y anular tickets", async () => {
    const e = await m.escenario();
    const o = e.operador;
    const cuenta = await abrir(e, o);
    const a = await agregar(o, cuenta, e.producto);
    valorDe(a.r);
    valorDe(
      await m.casos.anularLinea(o, { cuentaId: cuenta, lineaId: a.lineaId, motivo: "Error" }),
    );
    valorDe((await agregar(o, cuenta, e.producto)).r);
    const t = valorDe(await cerrar(o, cuenta));
    expect(t.numero).toBe(1);
    const otra = await abrir(e, o);
    valorDe(await m.casos.anularCuenta(o, { cuentaId: otra, motivo: "Se fue" }));
    valorDe(await anularTicket(o, t));
    expect(
      (
        await m.filas<{ emitido_por: string }>("select emitido_por from ticket where id = $1", [
          t.ticketId,
        ])
      )[0]?.emitido_por,
    ).toBe(e.personaDelOperador);
  });

  // ---- aislamiento (P14) ------------------------------------------------------------------------------------------------------

  it("P14: otra empresa no ve ni opera cuentas, líneas ni tickets: sus ids se comportan como inexistentes", async () => {
    const a = await m.escenario();
    const b = await m.escenario();
    const { cuenta, linea } = await cuentaConLinea(m, a);
    const t = await ticketDe(a);
    const abierta = await cuentaConLinea(m, a);
    const antes = await sinCambios(a);
    const antesB = await sinCambios(b);
    expect(falla((await agregar(b.gerente, abierta.cuenta, b.producto)).r)).toBe(
      "CUENTA_NO_ENCONTRADA",
    );
    expect(
      falla(
        await m.casos.anularLinea(b.gerente, {
          cuentaId: abierta.cuenta,
          lineaId: abierta.linea,
          motivo: "Error",
        }),
      ),
    ).toBe("CUENTA_NO_ENCONTRADA");
    expect(
      falla(await m.casos.anularCuenta(b.gerente, { cuentaId: abierta.cuenta, motivo: "Error" })),
    ).toBe("CUENTA_NO_ENCONTRADA");
    expect(falla(await cerrar(b.gerente, abierta.cuenta))).toBe("CUENTA_NO_ENCONTRADA");
    expect(falla(await anularTicket(b.gerente, t))).toBe("TICKET_NO_ENCONTRADO");
    expect(falla(await m.consultas.fichaDeTicket(b.gerente, { ticketId: t.ticketId }))).toBe(
      "TICKET_NO_ENCONTRADO",
    );
    // Con una cuenta propia, ni la línea ajena ni el producto ajeno existen.
    const propia = await abrir(b);
    expect(
      falla(
        await m.casos.anularLinea(b.gerente, { cuentaId: propia, lineaId: linea, motivo: "Error" }),
      ),
    ).toBe("LINEA_NO_ENCONTRADA");
    expect(falla((await agregar(b.gerente, propia, a.producto)).r)).toBe("PRODUCTO_NO_ENCONTRADO");
    // Abrir en una sucursal de la otra empresa no existe.
    expect(
      falla(await m.casos.abrirCuenta(b.gerente, { cuentaId: nuevoId(), sucursalId: a.sucursal })),
    ).toBe("SUCURSAL_NO_ENCONTRADA");
    expect(await sinCambios(a)).toEqual(antes);
    // De la empresa B solo cambió su propia cuenta (y su auditoría): nada de lo de A.
    expect(await sinCambios(b)).toEqual({ ...antesB, cuentas: 1, auditoria: 1 });
    expect((await cuentaEn(cuenta))?.estado).toBe("ABIERTA");
    // Lo ajeno no entra a la numeración: el número es de la sucursal de cada empresa.
    valorDe((await agregar(b.gerente, propia, b.producto)).r);
    expect(valorDe(await cerrar(b.gerente, propia))).toMatchObject({ numero: 1 });
  });

  // ---- jornada (P26) ----------------------------------------------------------------------------------------------------------

  /** El cierre del día sin aportes de módulos: deja pasar el cierre aun con cuentas abiertas (para probar qué hace ventas ante la jornada). */
  const sinAportes: readonly AporteAlCierreDelDia<TxDePrueba>[] = [];
  const cierreSinAportes = () =>
    crearCasosDeUsoDeCierre({ transacciones: m.entorno, reglas: REGLAS, aportes: sinAportes });
  const jornada = { fechaDeNegocio: FECHA_DE_NEGOCIO };

  it("P26: con la jornada EN_AUDITORIA, abrir, agregar y cerrar dan JORNADA_EN_AUDITORIA sin escribir; anular línea, cuenta y ticket siguen permitidos", async () => {
    const e = await m.escenario();
    const porAnularLinea = await cuentaConLinea(m, e);
    const porAnularCuenta = await cuentaConLinea(m, e);
    const abierta = await cuentaConLinea(m, e);
    const ticket = await ticketDe(e);
    const cierre = cierreSinAportes();
    valorDe(await cierre.iniciarAuditoria(e.gerente, { sucursalId: e.sucursal, ...jornada }));
    const antes = await sinCambios(e);
    expect(
      falla(await m.casos.abrirCuenta(e.gerente, { cuentaId: nuevoId(), sucursalId: e.sucursal })),
    ).toBe("JORNADA_EN_AUDITORIA");
    expect(falla((await agregar(e.gerente, abierta.cuenta, e.producto)).r)).toBe(
      "JORNADA_EN_AUDITORIA",
    );
    expect(falla(await cerrar(e.gerente, abierta.cuenta))).toBe("JORNADA_EN_AUDITORIA");
    expect(await sinCambios(e)).toEqual(antes);
    expect((await cuentaEn(abierta.cuenta))?.estado).toBe("ABIERTA");
    // Las salidas están abiertas: es lo que permite vaciar lo que bloquea el cierre.
    valorDe(
      await m.casos.anularLinea(e.gerente, {
        cuentaId: porAnularLinea.cuenta,
        lineaId: porAnularLinea.linea,
        motivo: "Error",
      }),
    );
    valorDe(
      await m.casos.anularCuenta(e.gerente, { cuentaId: porAnularCuenta.cuenta, motivo: "Se fue" }),
    );
    expect(valorDe(await anularTicket(e.gerente, ticket))).toMatchObject({ estado: "ANULADO" });
    expect((await cuentaEn(porAnularCuenta.cuenta))?.estado).toBe("ANULADA");
  });

  it("P26: con la jornada CERRADA, abrir, agregar y cerrar dan JORNADA_CERRADA y anularTicket también; anular línea y cuenta siguen", async () => {
    const e = await m.escenario();
    const abierta = await cuentaConLinea(m, e);
    const aparte = await cuentaConLinea(m, e);
    const ticket = await ticketDe(e);
    const cierre = cierreSinAportes();
    const entrada = { sucursalId: e.sucursal, ...jornada };
    valorDe(await cierre.iniciarAuditoria(e.gerente, entrada));
    valorDe(
      await cierre.cerrarJornada(e.gerente, {
        ...entrada,
        huellaVista: huellaDeControles([]),
        reconocimientos: [],
        observacion: null,
      }),
    );
    const antes = await sinCambios(e);
    expect(
      falla(await m.casos.abrirCuenta(e.gerente, { cuentaId: nuevoId(), sucursalId: e.sucursal })),
    ).toBe("JORNADA_CERRADA");
    expect(falla((await agregar(e.gerente, abierta.cuenta, e.producto)).r)).toBe("JORNADA_CERRADA");
    expect(falla(await cerrar(e.gerente, abierta.cuenta))).toBe("JORNADA_CERRADA");
    expect(falla(await anularTicket(e.gerente, ticket))).toBe("JORNADA_CERRADA");
    expect(await sinCambios(e)).toEqual(antes);
    // La anulación de una línea o una cuenta no mira la jornada (es la salida de lo abierto).
    valorDe(
      await m.casos.anularLinea(e.gerente, {
        cuentaId: abierta.cuenta,
        lineaId: abierta.linea,
        motivo: "Error",
      }),
    );
    valorDe(await m.casos.anularCuenta(e.gerente, { cuentaId: aparte.cuenta, motivo: "Se fue" }));
    // Mañana es otra jornada, abierta: se vende y también se puede anular el ticket de ayer (la anulación cuenta en la jornada de hoy).
    const mañana = en(e.gerente, "2026-11-10T15:00:00Z");
    const nueva = await ticketDe(e, mañana);
    expect(nueva).toMatchObject({ numero: 2, fechaNegocio: "2026-11-10" });
    valorDe(await anularTicket(mañana, ticket));
  });

  it("P26: una cuenta abierta BLOQUEA el inicio de la auditoría (ventas.cuentas_abiertas) hasta que se resuelve", async () => {
    const e = await m.escenario();
    const { cuenta } = await cuentaConLinea(m, e);
    const entrada = { sucursalId: e.sucursal, ...jornada };
    const bloqueada = falla(await m.cierre.iniciarAuditoria(e.gerente, entrada));
    expect(bloqueada).toMatchObject({
      codigo: "JORNADA_CON_IMPEDIMENTOS",
      impedimentos: [{ modulo: "ventas", clave: "ventas.cuentas_abiertas", cantidad: 1 }],
    });
    // Los controles en vivo lo muestran como BLOQUEA.
    const controles = valorDe(await m.consultasDeCierre.controlesDeLaJornada(e.gerente, entrada));
    expect(controles.controles.find((c) => c.clave === "ventas.cuentas_abiertas")).toMatchObject({
      severidad: "BLOQUEA",
      cantidad: 1,
    });
    // Una cuenta CERRADA o ANULADA no bloquea: se sale cerrando (con su ticket) o anulando.
    valorDe(await cerrar(e.gerente, cuenta));
    const otra = await cuentaConLinea(m, e);
    valorDe(await m.casos.anularCuenta(e.gerente, { cuentaId: otra.cuenta, motivo: "Se fue" }));
    expect(valorDe(await m.cierre.iniciarAuditoria(e.gerente, entrada))).toEqual({
      yaEstabaEnAuditoria: false,
    });
    // El ticket EMITIDO sin cobrar se reconoce al cerrar: no impide empezar.
    const reconocibles = valorDe(
      await m.consultasDeCierre.controlesDeLaJornada(e.gerente, entrada),
    );
    expect(
      reconocibles.controles.find((c) => c.clave === "ventas.tickets_por_cobrar"),
    ).toMatchObject({
      severidad: "RECONOCIBLE",
      cantidad: 1,
    });
    expect(reconocibles.controles.find((c) => c.clave === "ventas.cuentas_abiertas")).toMatchObject(
      {
        cantidad: 0,
      },
    );
    // Aporte: misma jornada, misma huella (determinista).
    const otraVez = valorDe(await m.consultasDeCierre.controlesDeLaJornada(e.gerente, entrada));
    expect(otraVez.huella).toBe(reconocibles.huella);
    // El aporte se importa para el cierre real y es de `ventas`.
    expect(aporteDeVentas.modulo).toBe("ventas");
  });

  // ---- atomicidad (P5) --------------------------------------------------------------------------------------------------------

  it("P5: una falla en la auditoría del ticket no deja cuenta cerrada, ticket, ejemplar ni número consumido; el siguiente cierre toma el mismo número", async () => {
    const e = await m.escenario();
    let fallar = false;
    const entorno = crearEntornoDePrueba(m.propia.base, 4, (tx) => ({
      ...tx,
      autorizacion: {
        ...tx.autorizacion,
        delActor: async (contexto) => {
          const datos = await tx.autorizacion.delActor(contexto);
          return datos.rol === null
            ? datos
            : {
                ...datos,
                modulosActivados: [...datos.modulosActivados, "catalogo", "ventas", "cierre"],
                modulosHabilitados: [...datos.modulosHabilitados, "catalogo", "ventas", "cierre"],
              };
        },
      },
      auditoria: {
        ...tx.auditoria,
        registrar: async (registro) => {
          if (fallar && registro.accion === "TICKET_EMITIDO") {
            throw new Error("falla inyectada después de numerar y emitir");
          }
          await tx.auditoria.registrar(registro);
        },
      },
    }));
    try {
      const casos = crearCasosDeUsoDeVentas({ transacciones: entorno, reglas: REGLAS });
      const cuenta = nuevoId();
      valorDe(await casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
      valorDe(
        await casos.agregarLinea(e.gerente, {
          cuentaId: cuenta,
          lineaId: nuevoId(),
          productoId: e.producto,
          opcionIds: [],
          cantidad: "2",
        }),
      );
      const antes = await sinCambios(e);
      fallar = true;
      await expect(
        casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() }),
      ).rejects.toThrow("falla inyectada");
      fallar = false;
      expect(await sinCambios(e)).toEqual(antes);
      expect(await contar("ticket", e.empresa)).toBe(0);
      expect(await contar("ticket_ejemplar", e.empresa)).toBe(0);
      expect(await contar("ejemplar_linea", e.empresa)).toBe(0);
      expect(await numerador(e)).toBe(0);
      expect((await cuentaEn(cuenta))?.estado).toBe("ABIERTA");
      expect((await m.auditoria(e.empresa, "CUENTA_CERRADA")).length).toBe(0);
      // Otra cuenta cierra y toma el número 1: el que habría tomado la que falló.
      const otra = nuevoId();
      valorDe(await casos.abrirCuenta(e.gerente, { cuentaId: otra, sucursalId: e.sucursal }));
      valorDe(
        await casos.agregarLinea(e.gerente, {
          cuentaId: otra,
          lineaId: nuevoId(),
          productoId: e.producto,
          opcionIds: [],
          cantidad: "1",
        }),
      );
      expect(
        valorDe(await casos.cerrarCuenta(e.gerente, { cuentaId: otra, ejemplarId: nuevoId() })),
      ).toMatchObject({
        numero: 1,
      });
      // Y la que había fallado, ya sin falla, toma el 2: nunca quedó un hueco.
      expect(
        valorDe(await casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId: nuevoId() })),
      ).toMatchObject({
        numero: 2,
      });
      expect(await numerador(e)).toBe(2);
    } finally {
      await entorno.cerrar();
    }
  });

  it("P27(d): una falla en la auditoría de la anulación no deja ejemplar nuevo ni estado ANULADO", async () => {
    const e = await m.escenario();
    const t = await ticketDe(e);
    const entorno = crearEntornoDePrueba(m.propia.base, 4, (tx) => ({
      ...tx,
      autorizacion: {
        ...tx.autorizacion,
        delActor: async (contexto) => {
          const datos = await tx.autorizacion.delActor(contexto);
          return datos.rol === null
            ? datos
            : {
                ...datos,
                modulosActivados: [...datos.modulosActivados, "catalogo", "ventas", "cierre"],
                modulosHabilitados: [...datos.modulosHabilitados, "catalogo", "ventas", "cierre"],
              };
        },
      },
      auditoria: {
        ...tx.auditoria,
        registrar: (registro) =>
          registro.accion === "TICKET_ANULADO"
            ? Promise.reject(new Error("falla inyectada en la anulación"))
            : tx.auditoria.registrar(registro),
      },
    }));
    try {
      const casos = crearCasosDeUsoDeVentas({ transacciones: entorno, reglas: REGLAS });
      const antes = await sinCambios(e);
      await expect(
        casos.anularTicket(e.gerente, {
          claveIdempotencia: nuevaClave(),
          ticketId: t.ticketId,
          ejemplarBaseId: t.ejemplarId,
          ejemplarNuevoId: nuevoId(),
          motivo: "Error",
        }),
      ).rejects.toThrow("falla inyectada");
      expect(await sinCambios(e)).toEqual(antes);
      expect(await contar("ticket_correccion", e.empresa)).toBe(0);
      expect(
        (
          await m.filas<{ estado: string; v: number }>(
            "select estado, ejemplar_vigente as v from ticket where id = $1",
            [t.ticketId],
          )
        )[0],
      ).toEqual({ estado: "EMITIDO", v: 1 });
      // Sin la falla, la misma anulación sale.
      valorDe(await anularTicket(e.gerente, t));
    } finally {
      await entorno.cerrar();
    }
  });
});
