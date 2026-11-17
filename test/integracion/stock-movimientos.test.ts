import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { traducirMovimiento } from "../../src/modulos/stock/casos-de-uso/movimientos-comun";
import { huellaDeComando } from "../../src/modulos/stock/dominio/huella";
import { ok } from "../../src/primitivas/resultado/resultado";
import { fechaDeNegocio } from "../../src/primitivas/tiempo/fecha-de-negocio";
import { personaId } from "../../src/primitivas/identificadores/marca";
import { sucursalDeBase } from "./stock-apoyo";
import {
  montarStock,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E5-T5: movimientos de stock (entrada, salida, transferencia, ajuste, anulación y sus consultas) contra la base real y con las dependencias
 * reales. Permisos por rol y alcance, validación (lista de permitidos), conversión exacta de unidades, los tres niveles del control de existencia
 * negativa, la jornada (P21), cuarentena y rechazo (P22) y la inmutabilidad del libro (P16). La idempotencia, la concurrencia, el aislamiento
 * entre empresas y la propiedad del saldo están en sus propios archivos.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const NEGATIVA = "stock.existencia_negativa";

describe.skipIf(base === null)("stock: movimientos", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Un depósito normal y un artículo en unidades, listos para mover. */
  const nuevo = async (datos: Parameters<MontajeDeStock["articulo"]>[1] = {}) => ({
    dep: await c.deposito(e),
    ...(await c.articulo(e, datos)),
  });
  const pedido = (producto: string, cantidad: string, unidadId = "UNIDAD") => ({
    productoId: producto,
    cantidad,
    unidadId,
  });
  const entrar = (
    producto: string,
    deposito: string,
    cantidad: string,
    quien = e.gerente,
    extra: Record<string, unknown> = {},
  ) =>
    c.casos.registrarEntrada(quien, {
      clave: nuevoId(),
      depositoId: deposito,
      motivo: "COMPRA",
      renglones: [pedido(producto, cantidad)],
      ...extra,
    });
  const sacar = (
    producto: string,
    deposito: string,
    cantidad: string,
    quien = e.gerente,
    extra: Record<string, unknown> = {},
  ) =>
    c.casos.registrarSalida(quien, {
      clave: nuevoId(),
      depositoId: deposito,
      motivo: "MERMA",
      renglones: [pedido(producto, cantidad)],
      ...extra,
    });
  /** Una existencia inicial por el caso de uso real. */
  const conExistencia = async (cantidad: string, datos: Parameters<typeof nuevo>[0] = {}) => {
    const n = await nuevo(datos);
    valorDe(await entrar(n.producto, n.dep, cantidad));
    return n;
  };
  const movimiento = async (id: string) =>
    (await c.filas("select * from movimiento_de_stock where id = $1", [id]))[0];
  const renglones = (id: string) =>
    c.filas(
      "select deposito_id, articulo_id, cantidad::text as cantidad, composicion_id, confirmo_negativo from renglon_de_movimiento where movimiento_id = $1 order by numero",
      [id],
    );
  const cuantosMovimientos = (empresa = e.empresa) =>
    c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [empresa]);

  // =============================================================================================
  describe("registrarEntrada", () => {
    it("el gerente registra una entrada: queda en el libro con su autor, su acción y su fecha de negocio, y el saldo sube", async () => {
      const n = await nuevo();
      const r = valorDe(
        await entrar(n.producto, n.dep, "10", e.gerente, { detalle: "Factura 12" }),
      );
      expect(r.yaExistia).toBe(false);
      expect(await movimiento(r.movimientoId)).toMatchObject({
        empresa_id: e.empresa,
        clase: "ENTRADA",
        motivo: "COMPRA",
        detalle: "Factura 12",
        origen_tipo: "MANUAL",
        origen_id: null,
        deposito_id: n.dep,
        accion: "stock.registrar_entrada",
        anula_a: null,
        conteo_id: null,
        registrado_por: e.personaDelGerente,
      });
      expect(await renglones(r.movimientoId)).toEqual([
        {
          deposito_id: n.dep,
          articulo_id: n.articulo,
          cantidad: "10.0000",
          composicion_id: null,
          confirmo_negativo: false,
        },
      ]);
      expect(await c.existencia(n.dep, n.articulo)).toBe("10.0000");
    });

    it("el movimiento es su propio registro: no suma nada a la auditoría de la empresa", async () => {
      const n = await nuevo();
      const antes = (await c.auditoria(e.empresa)).length;
      valorDe(await entrar(n.producto, n.dep, "3"));
      expect((await c.auditoria(e.empresa)).length).toBe(antes);
    });

    it("lleva la cantidad a la unidad de stock del artículo de forma EXACTA: 2 kilos entran como 2000 gramos", async () => {
      const n = await nuevo({ unidadBase: "GRAMO", dimension: "MASA" });
      const r = valorDe(
        await c.casos.registrarEntrada(e.gerente, {
          clave: nuevoId(),
          depositoId: n.dep,
          motivo: "COMPRA",
          renglones: [pedido(n.producto, "2", "KILOGRAMO")],
        }),
      );
      expect((await renglones(r.movimientoId))[0]?.["cantidad"]).toBe("2000.0000");
      expect(await c.existencia(n.dep, n.articulo)).toBe("2000.0000");
    });

    it("rechaza lo que no es exacto o no es de la misma dimensión, y lo que no es una cantidad mayor que cero, sin escribir nada", async () => {
      const gramos = await nuevo({ unidadBase: "GRAMO", dimension: "MASA" });
      const toneladas = await nuevo({ unidadBase: "TONELADA", dimension: "MASA" });
      const antes = await cuantosMovimientos();
      const caso = (n: { dep: string; producto: string }, cantidad: string, unidad: string) =>
        entrar(n.producto, n.dep, cantidad, e.gerente, {
          renglones: [pedido(n.producto, cantidad, unidad)],
        });
      expect(await caso(toneladas, "1", "GRAMO")).toEqual({
        ok: false,
        error: "CONVERSION_NO_EXACTA",
      });
      expect(await caso(gramos, "1", "LITRO")).toEqual({ ok: false, error: "DIMENSION_DISTINTA" });
      expect(await caso(gramos, "1", "PARSEC")).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      for (const cantidad of ["0", "-1", "abc", "", "1e3", "1,5", "0.00001", " 1"]) {
        expect(await caso(gramos, cantidad, "GRAMO"), cantidad).toEqual({
          ok: false,
          error: "CANTIDAD_INVALIDA",
        });
      }
      expect(await cuantosMovimientos()).toBe(antes);
    });

    it("valida lo que llega con lista de permitidos: clave, motivo, detalle, renglones y depósito", async () => {
      const n = await nuevo();
      const antes = await cuantosMovimientos();
      const base = {
        clave: nuevoId(),
        depositoId: n.dep,
        motivo: "COMPRA",
        renglones: [pedido(n.producto, "1")],
      };
      const probar = (extra: Record<string, unknown>) =>
        c.casos.registrarEntrada(e.gerente, { ...base, ...extra });
      expect(await probar({ clave: "no-es-un-uuid" })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      // `VENTA` es de una salida por el puerto de ventas, y los motivos de salida no son de una entrada.
      for (const motivo of [
        "VENTA",
        "MERMA",
        "TRANSFERENCIA",
        "CORRECCION",
        "ANULACION",
        "compra",
        "",
        "OTRA",
      ]) {
        expect(await probar({ motivo }), motivo).toEqual({
          ok: false,
          error: "MOTIVO_NO_PERMITIDO",
        });
      }
      for (const detalle of [
        "",
        "   ",
        "Lleva\nsalto",
        "<b>x</b>",
        "=SUMA(A1)",
        "Con 🍕",
        "x".repeat(301),
      ]) {
        expect(await probar({ detalle }), JSON.stringify(detalle)).toEqual({
          ok: false,
          error: "DETALLE_REQUERIDO",
        });
      }
      expect(await probar({ renglones: [] })).toEqual({ ok: false, error: "RENGLONES_INVALIDOS" });
      expect(await probar({ renglones: "uno" })).toEqual({
        ok: false,
        error: "RENGLONES_INVALIDOS",
      });
      expect(
        await probar({ renglones: [pedido(n.producto, "1"), pedido(n.producto, "2")] }),
      ).toEqual({
        ok: false,
        error: "RENGLON_REPETIDO",
      });
      expect(await probar({ depositoId: "no-es-un-uuid" })).toEqual({
        ok: false,
        error: "DEPOSITO_NO_ENCONTRADO",
      });
      expect(await probar({ depositoId: nuevoId() })).toEqual({
        ok: false,
        error: "DEPOSITO_NO_ENCONTRADO",
      });
      expect(await probar({ renglones: [pedido("no-es-un-uuid", "1")] })).toEqual({
        ok: false,
        error: "ARTICULO_NO_CONTROLADO",
      });
      expect(await probar({ renglones: [pedido(nuevoId(), "1")] })).toEqual({
        ok: false,
        error: "ARTICULO_NO_CONTROLADO",
      });
      expect(await cuantosMovimientos()).toBe(antes);
    });

    it("no mueve un artículo que dejó de controlarse ni un depósito inactivo", async () => {
      const n = await nuevo();
      const inactivo = await c.articulo(e, { activo: false });
      expect(await entrar(inactivo.producto, n.dep, "1")).toEqual({
        ok: false,
        error: "ARTICULO_NO_CONTROLADO",
      });
      const depInactivo = await c.deposito(e, { activo: false });
      expect(await entrar(n.producto, depInactivo, "1")).toEqual({
        ok: false,
        error: "DEPOSITO_INACTIVO",
      });
    });

    it("un producto sin artículo de stock no se mueve", async () => {
      const n = await nuevo();
      const { productoDeBase } = await import("./catalogo-apoyo");
      const suelto = await productoDeBase(c.dueno, e.empresa, { clase: "MATERIA_PRIMA" });
      expect(await entrar(suelto, n.dep, "1")).toEqual({
        ok: false,
        error: "ARTICULO_NO_CONTROLADO",
      });
    });
  });

  // =============================================================================================
  describe("permisos por rol y alcance de sucursal", () => {
    it("el operador registra entradas y salidas y transfiere en SU sucursal", async () => {
      const a = await conExistencia("5");
      const destino = await c.deposito(e);
      valorDe(await entrar(a.producto, a.dep, "2", e.operador));
      valorDe(await sacar(a.producto, a.dep, "1", e.operador));
      valorDe(
        await c.casos.transferir(e.operador, {
          clave: nuevoId(),
          origenId: a.dep,
          destinoId: destino,
          renglones: [pedido(a.producto, "3")],
        }),
      );
      expect(await c.existencia(a.dep, a.articulo)).toBe("3.0000");
      expect(await c.existencia(destino, a.articulo)).toBe("3.0000");
    });

    it("el operador no ajusta ni anula (SIN_PERMISO) y nada se escribe", async () => {
      const a = await conExistencia("5");
      const entradaPrevia = valorDe(await entrar(a.producto, a.dep, "1"));
      const antes = await cuantosMovimientos();
      expect(
        await c.casos.ajustar(e.operador, {
          clave: nuevoId(),
          depositoId: a.dep,
          detalle: "Se rompió",
          renglones: [{ ...pedido(a.producto, "1"), sentido: "RESTA" }],
        }),
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(
        await c.casos.anularMovimiento(e.operador, {
          clave: nuevoId(),
          movimientoId: entradaPrevia.movimientoId,
          detalle: "Error de carga",
        }),
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(await cuantosMovimientos()).toBe(antes);
    });

    it("el administrador y el gerente ajustan y anulan", async () => {
      const a = await conExistencia("5");
      const m = valorDe(await entrar(a.producto, a.dep, "1"));
      valorDe(
        await c.casos.ajustar(e.administrador, {
          clave: nuevoId(),
          depositoId: a.dep,
          detalle: "Conté de más",
          renglones: [{ ...pedido(a.producto, "1"), sentido: "RESTA" }],
        }),
      );
      valorDe(
        await c.casos.anularMovimiento(e.gerente, {
          clave: nuevoId(),
          movimientoId: m.movimientoId,
          detalle: "Error de carga",
        }),
      );
    });

    it("el operador no toca un depósito de otra sucursal, y una transferencia necesita las DOS sucursales en su alcance", async () => {
      const propio = await conExistencia("5");
      const ajeno = await c.deposito(e, { sucursal: e.otraSucursal });
      expect(await entrar(propio.producto, ajeno, "1", e.operador)).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      expect(await sacar(propio.producto, ajeno, "1", e.operador)).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      for (const [origenId, destinoId] of [
        [propio.dep, ajeno],
        [ajeno, propio.dep],
      ] as const) {
        expect(
          await c.casos.transferir(e.operador, {
            clave: nuevoId(),
            origenId,
            destinoId,
            renglones: [pedido(propio.producto, "1")],
          }),
        ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      }
      expect(await c.existencia(propio.dep, propio.articulo)).toBe("5.0000");
      // El gerente (todas las sucursales) sí puede.
      valorDe(
        await c.casos.transferir(e.gerente, {
          clave: nuevoId(),
          origenId: propio.dep,
          destinoId: ajeno,
          renglones: [pedido(propio.producto, "1")],
        }),
      );
    });

    it("un administrador con alcance de una sola sucursal tampoco anula lo de otra", async () => {
      const ajeno = await c.deposito(e, { sucursal: e.otraSucursal });
      const a = await c.articulo(e);
      const m = valorDe(await entrar(a.producto, ajeno, "2"));
      expect(
        await c.casos.anularMovimiento(e.administradorDeUnaSucursal, {
          clave: nuevoId(),
          movimientoId: m.movimientoId,
          detalle: "No es mío",
        }),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
    });

    it("dar de baja por VENCIMIENTO exige además `stock.ajustar` (S-7): el operador no, el administrador sí; el resto de los motivos, todos", async () => {
      const a = await conExistencia("10");
      expect(await sacar(a.producto, a.dep, "1", e.operador, { motivo: "VENCIMIENTO" })).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      for (const motivo of ["CONSUMO_INTERNO", "MERMA", "ROTURA", "OTRA_SALIDA"]) {
        valorDe(await sacar(a.producto, a.dep, "1", e.operador, { motivo }));
      }
      valorDe(await sacar(a.producto, a.dep, "1", e.administrador, { motivo: "VENCIMIENTO" }));
      expect(await c.existencia(a.dep, a.articulo)).toBe("5.0000");
    });

    it("con el módulo apagado no se mueve nada (MODULO_NO_ACTIVO), aunque el rol lo permita", async () => {
      const n = await nuevo();
      c.apagarModulo("stock");
      try {
        expect(await entrar(n.producto, n.dep, "1")).toEqual({
          ok: false,
          error: "MODULO_NO_ACTIVO",
        });
        expect(await c.consultas.existencias(e.gerente)).toEqual({
          ok: false,
          error: "MODULO_NO_ACTIVO",
        });
      } finally {
        c.encenderModulos();
      }
    });
  });

  // =============================================================================================
  describe("registrarSalida y el control de existencia negativa", () => {
    it("VENTA no se admite en una salida manual (solo por el puerto de ventas)", async () => {
      const a = await conExistencia("5");
      expect(await sacar(a.producto, a.dep, "1", e.gerente, { motivo: "VENTA" })).toEqual({
        ok: false,
        error: "MOTIVO_NO_PERMITIDO",
      });
      for (const motivo of ["COMPRA", "TRANSFERENCIA", "CORRECCION", "ANULACION", "CONTEO"]) {
        expect(await sacar(a.producto, a.dep, "1", e.gerente, { motivo }), motivo).toEqual({
          ok: false,
          error: "MOTIVO_NO_PERMITIDO",
        });
      }
      expect(await c.existencia(a.dep, a.articulo)).toBe("5.0000");
    });

    it("sin nivel guardado rige PERMITIR: la salida pasa, deja la existencia en negativo y la excepción queda auditada", async () => {
      const emp = await c.escenario();
      const dep = await c.deposito(emp);
      const a = await c.articulo(emp);
      const r = valorDe(
        await c.casos.registrarSalida(emp.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "MERMA",
          renglones: [pedido(a.producto, "2")],
        }),
      );
      expect(r.yaExistia).toBe(false);
      expect(r.excepciones).toEqual([
        { productoId: a.producto, depositoId: dep, existenciaResultante: "-2.0000" },
      ]);
      expect(await c.existencia(dep, a.articulo)).toBe("-2.0000");
      const registros = await c.auditoria(emp.empresa, "CONTROL_EXCEPCION");
      expect(registros).toHaveLength(1);
      expect(registros[0]).toMatchObject({
        actor_persona_id: emp.personaDelGerente,
        entidad: "movimiento_de_stock",
        entidad_id: r.movimientoId,
        despues: {
          control: NEGATIVA,
          nivel: "PERMITIR",
          avisoAceptado: false,
          depositoId: dep,
          productoId: a.producto,
          existenciaResultante: "-2.0000",
        },
      });
    });

    it("una salida que no deja la existencia en negativo no es una excepción: no se audita nada", async () => {
      const emp = await c.escenario();
      const dep = await c.deposito(emp);
      const a = await c.articulo(emp);
      valorDe(
        await c.casos.registrarEntrada(emp.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [pedido(a.producto, "5")],
        }),
      );
      const r = valorDe(
        await c.casos.registrarSalida(emp.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "MERMA",
          renglones: [pedido(a.producto, "5")],
        }),
      );
      expect(r.excepciones).toEqual([]);
      expect(await c.existencia(dep, a.articulo)).toBe("0.0000");
      expect(await c.auditoria(emp.empresa, "CONTROL_EXCEPCION")).toHaveLength(0);
    });

    it("BLOQUEAR: CONTROL_BLOQUEA con el detalle de lo que quedaría en negativo, aunque venga la confirmación; no se escribe nada", async () => {
      const emp = await c.escenario();
      await c.fijarNivel(emp.empresa, "BLOQUEAR");
      const dep = await c.deposito(emp);
      const a = await c.articulo(emp);
      const b = await c.articulo(emp);
      valorDe(
        await c.casos.registrarEntrada(emp.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [pedido(a.producto, "1"), pedido(b.producto, "10")],
        }),
      );
      const antes = await c.contar(
        "select count(*) as n from movimiento_de_stock where empresa_id = $1",
        [emp.empresa],
      );
      for (const confirmaciones of [undefined, [NEGATIVA]]) {
        const r = await c.casos.registrarSalida(emp.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "MERMA",
          confirmaciones,
          renglones: [pedido(a.producto, "3"), pedido(b.producto, "4")],
        });
        expect(r).toEqual({
          ok: false,
          error: {
            error: "CONTROL_BLOQUEA",
            control: NEGATIVA,
            detalle: [{ productoId: a.producto, depositoId: dep, existenciaResultante: "-2.0000" }],
          },
        });
      }
      expect(
        await c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [
          emp.empresa,
        ]),
      ).toBe(antes);
      expect(await c.existencia(dep, a.articulo)).toBe("1.0000");
      expect(await c.existencia(dep, b.articulo)).toBe("10.0000");
      // Lo que no deja en negativo pasa aunque el control bloquee.
      valorDe(
        await c.casos.registrarSalida(emp.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "MERMA",
          renglones: [pedido(a.producto, "1")],
        }),
      );
      expect(await c.existencia(dep, a.articulo)).toBe("0.0000");
    });

    it("AVISAR: sin confirmación CONTROL_REQUIERE_CONFIRMACION; con ella pasa, el renglón guarda la confirmación y la excepción se audita con el aviso aceptado", async () => {
      const emp = await c.escenario();
      await c.fijarNivel(emp.empresa, "AVISAR");
      const dep = await c.deposito(emp);
      const a = await c.articulo(emp);
      const clave = nuevoId();
      const pedidoDeSalida = {
        clave,
        depositoId: dep,
        motivo: "MERMA",
        renglones: [pedido(a.producto, "2")],
      };
      expect(await c.casos.registrarSalida(emp.gerente, pedidoDeSalida)).toEqual({
        ok: false,
        error: {
          error: "CONTROL_REQUIERE_CONFIRMACION",
          control: NEGATIVA,
          detalle: [{ productoId: a.producto, depositoId: dep, existenciaResultante: "-2.0000" }],
        },
      });
      expect(await c.existencia(dep, a.articulo)).toBe("0");
      // El mismo pedido con la misma clave, ya confirmado: la primera vez no escribió nada, así que no es una clave reutilizada.
      const r = valorDe(
        await c.casos.registrarSalida(emp.gerente, {
          ...pedidoDeSalida,
          confirmaciones: [NEGATIVA],
        }),
      );
      expect((await renglones(r.movimientoId))[0]).toMatchObject({
        cantidad: "-2.0000",
        confirmo_negativo: true,
      });
      expect(await c.existencia(dep, a.articulo)).toBe("-2.0000");
      const registros = await c.auditoria(emp.empresa, "CONTROL_EXCEPCION");
      expect(registros).toHaveLength(1);
      expect(registros[0]).toMatchObject({
        despues: { nivel: "AVISAR", avisoAceptado: true, existenciaResultante: "-2.0000" },
      });
    });

    it("una confirmación que no es la del control se rechaza", async () => {
      const a = await conExistencia("1");
      expect(
        await sacar(a.producto, a.dep, "1", e.gerente, { confirmaciones: ["otro.control"] }),
      ).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
    });

    it("la sucursal puede endurecer el nivel de la empresa: BLOQUEAR en una sucursal no bloquea a la otra", async () => {
      const emp = await c.escenario();
      await c.fijarNivel(emp.empresa, "PERMITIR");
      await c.fijarNivel(emp.empresa, "BLOQUEAR", emp.otraSucursal);
      const enNorte = await c.deposito(emp, { sucursal: emp.otraSucursal });
      const enCentral = await c.deposito(emp);
      const a = await c.articulo(emp);
      const salida = (depositoId: string) =>
        c.casos.registrarSalida(emp.gerente, {
          clave: nuevoId(),
          depositoId,
          motivo: "MERMA",
          renglones: [pedido(a.producto, "1")],
        });
      expect(await salida(enNorte)).toMatchObject({
        ok: false,
        error: { error: "CONTROL_BLOQUEA" },
      });
      valorDe(await salida(enCentral));
    });

    it("el ajuste y la anulación NUNCA se bloquean por existencia negativa (un conteo que encuentra menos tiene que poder aplicarse)", async () => {
      const emp = await c.escenario();
      await c.fijarNivel(emp.empresa, "BLOQUEAR");
      const dep = await c.deposito(emp);
      const a = await c.articulo(emp);
      const entrada = valorDe(
        await c.casos.registrarEntrada(emp.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [pedido(a.producto, "2")],
        }),
      );
      valorDe(
        await c.casos.ajustar(emp.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          detalle: "Se perdió",
          renglones: [{ ...pedido(a.producto, "5"), sentido: "RESTA" }],
        }),
      );
      expect(await c.existencia(dep, a.articulo)).toBe("-3.0000");
      valorDe(
        await c.casos.anularMovimiento(emp.gerente, {
          clave: nuevoId(),
          movimientoId: entrada.movimientoId,
          detalle: "Error de carga",
        }),
      );
      expect(await c.existencia(dep, a.articulo)).toBe("-5.0000");
      expect(await c.auditoria(emp.empresa, "CONTROL_EXCEPCION")).toHaveLength(0);
    });

    it("la red de seguridad de la base: si el disparador rechaza por existencia negativa, el error sale como el del control (con el detalle vacío)", async () => {
      const emp = await c.escenario();
      await c.fijarNivel(emp.empresa, "BLOQUEAR");
      const dep = await c.deposito(emp);
      const a = await c.articulo(emp);
      const desdeLaBase = () =>
        c.entorno.ejecutar({ contexto: emp.gerente }, async (tx) => {
          await tx.movimientosDeStock.registrar(
            emp.empresaId,
            {
              clase: "SALIDA",
              motivo: "MERMA",
              detalle: null,
              origenTipo: "MANUAL",
              origenId: null,
              depositoId: dep,
              accion: "stock.registrar_salida",
              anulaA: null,
              conteoId: null,
              clave: `clave-${nuevoId()}`,
              huella: huellaDeComando("x", [], []),
              hechoEn: emp.gerente.ahora,
              fechaDeNegocio: null,
              registradoPor: personaId(emp.personaDelGerente),
            },
            [
              {
                depositoId: dep,
                articuloId: a.articulo,
                cantidad: "-1",
                composicionId: null,
                confirmoNegativo: false,
              },
            ],
          );
          return ok(null);
        });
      expect(traducirMovimiento(await desdeLaBase())).toEqual({
        ok: false,
        error: { error: "CONTROL_BLOQUEA", control: NEGATIVA, detalle: [] },
      });
      await c.dueno.query("update nivel_de_control set nivel = 'AVISAR' where empresa_id = $1", [
        emp.empresa,
      ]);
      expect(traducirMovimiento(await desdeLaBase())).toEqual({
        ok: false,
        error: { error: "CONTROL_REQUIERE_CONFIRMACION", control: NEGATIVA, detalle: [] },
      });
    });
  });

  // =============================================================================================
  describe("transferir", () => {
    it("es UN movimiento con dos patas por artículo: sale del origen y entra en el destino, y el total no cambia", async () => {
      const a = await conExistencia("10");
      const b = await c.articulo(e);
      valorDe(await entrar(b.producto, a.dep, "4"));
      const destino = await c.deposito(e);
      const r = valorDe(
        await c.casos.transferir(e.gerente, {
          clave: nuevoId(),
          origenId: a.dep,
          destinoId: destino,
          renglones: [pedido(a.producto, "3"), pedido(b.producto, "4")],
        }),
      );
      expect(r.excepciones).toEqual([]);
      expect(await movimiento(r.movimientoId)).toMatchObject({
        clase: "TRANSFERENCIA",
        motivo: "TRANSFERENCIA",
        deposito_id: a.dep,
        accion: "stock.transferir",
      });
      expect(
        (await renglones(r.movimientoId))
          .map((x) => [x["deposito_id"], x["articulo_id"], x["cantidad"]])
          .sort(),
      ).toEqual(
        [
          [a.dep, a.articulo, "-3.0000"],
          [destino, a.articulo, "3.0000"],
          [a.dep, b.articulo, "-4.0000"],
          [destino, b.articulo, "4.0000"],
        ].sort(),
      );
      expect(await c.existencia(a.dep, a.articulo)).toBe("7.0000");
      expect(await c.existencia(destino, a.articulo)).toBe("3.0000");
      expect(await c.existencia(a.dep, b.articulo)).toBe("0.0000");
    });

    it("el origen y el destino no pueden ser el mismo; un destino que no existe o está inactivo se rechaza", async () => {
      const a = await conExistencia("10");
      const pedir = (destinoId: string) =>
        c.casos.transferir(e.gerente, {
          clave: nuevoId(),
          origenId: a.dep,
          destinoId,
          renglones: [pedido(a.producto, "1")],
        });
      expect(await pedir(a.dep)).toEqual({ ok: false, error: "TRANSFERENCIA_AL_MISMO_DEPOSITO" });
      expect(await pedir(nuevoId())).toEqual({
        ok: false,
        error: "DEPOSITO_DE_DESTINO_NO_ENCONTRADO",
      });
      expect(await pedir(await c.deposito(e, { activo: false }))).toEqual({
        ok: false,
        error: "DEPOSITO_INACTIVO",
      });
      expect(await c.existencia(a.dep, a.articulo)).toBe("10.0000");
    });

    it("el control de existencia negativa mira solo el origen: con BLOQUEAR no deja transferir más de lo que hay", async () => {
      const emp = await c.escenario();
      await c.fijarNivel(emp.empresa, "BLOQUEAR");
      const origen = await c.deposito(emp);
      const destino = await c.deposito(emp);
      const a = await c.articulo(emp);
      valorDe(
        await c.casos.registrarEntrada(emp.gerente, {
          clave: nuevoId(),
          depositoId: origen,
          motivo: "COMPRA",
          renglones: [pedido(a.producto, "2")],
        }),
      );
      const mover = (cantidad: string) =>
        c.casos.transferir(emp.gerente, {
          clave: nuevoId(),
          origenId: origen,
          destinoId: destino,
          renglones: [pedido(a.producto, cantidad)],
        });
      expect(await mover("3")).toMatchObject({
        ok: false,
        error: {
          error: "CONTROL_BLOQUEA",
          detalle: [
            { productoId: a.producto, depositoId: origen, existenciaResultante: "-1.0000" },
          ],
        },
      });
      valorDe(await mover("2"));
      expect(await c.existencia(origen, a.articulo)).toBe("0.0000");
      expect(await c.existencia(destino, a.articulo)).toBe("2.0000");
    });

    it("un renglón repetido o sin renglones se rechaza", async () => {
      const a = await conExistencia("10");
      const destino = await c.deposito(e);
      const mover = (renglonesPedidos: unknown) =>
        c.casos.transferir(e.gerente, {
          clave: nuevoId(),
          origenId: a.dep,
          destinoId: destino,
          renglones: renglonesPedidos as never,
        });
      expect(await mover([])).toEqual({ ok: false, error: "RENGLONES_INVALIDOS" });
      expect(await mover([pedido(a.producto, "1"), pedido(a.producto, "1")])).toEqual({
        ok: false,
        error: "RENGLON_REPETIDO",
      });
    });
  });

  // =============================================================================================
  describe("ajustar", () => {
    it("cada renglón suma o resta, el detalle es obligatorio y queda guardado", async () => {
      const a = await conExistencia("10");
      const b = await c.articulo(e);
      const r = valorDe(
        await c.casos.ajustar(e.gerente, {
          clave: nuevoId(),
          depositoId: a.dep,
          detalle: "Inventario de fin de mes",
          renglones: [
            { ...pedido(a.producto, "4"), sentido: "RESTA" },
            { ...pedido(b.producto, "2"), sentido: "SUMA" },
          ],
        }),
      );
      expect(await movimiento(r.movimientoId)).toMatchObject({
        clase: "AJUSTE",
        motivo: "CORRECCION",
        detalle: "Inventario de fin de mes",
        accion: "stock.ajustar",
      });
      expect(await c.existencia(a.dep, a.articulo)).toBe("6.0000");
      expect(await c.existencia(a.dep, b.articulo)).toBe("2.0000");
    });

    it("sin detalle (o con un sentido que no es SUMA ni RESTA) no ajusta", async () => {
      const a = await conExistencia("10");
      const ajustar = (extra: Record<string, unknown>) =>
        c.casos.ajustar(e.gerente, {
          clave: nuevoId(),
          depositoId: a.dep,
          detalle: "Corrección",
          renglones: [{ ...pedido(a.producto, "1"), sentido: "SUMA" }],
          ...extra,
        } as never);
      expect(await ajustar({ detalle: undefined })).toEqual({
        ok: false,
        error: "DETALLE_REQUERIDO",
      });
      expect(await ajustar({ detalle: "  " })).toEqual({ ok: false, error: "DETALLE_REQUERIDO" });
      expect(
        await ajustar({ renglones: [{ ...pedido(a.producto, "1"), sentido: "MULTIPLICA" }] }),
      ).toEqual({
        ok: false,
        error: "RENGLONES_INVALIDOS",
      });
      expect(await c.existencia(a.dep, a.articulo)).toBe("10.0000");
    });
  });

  // =============================================================================================
  describe("anularMovimiento", () => {
    it("inserta el espejo EXACTO: mismos depósitos y artículos con la cantidad opuesta, y el saldo vuelve", async () => {
      const a = await conExistencia("10");
      const destino = await c.deposito(e);
      const t = valorDe(
        await c.casos.transferir(e.gerente, {
          clave: nuevoId(),
          origenId: a.dep,
          destinoId: destino,
          renglones: [pedido(a.producto, "4")],
        }),
      );
      const anulacion = valorDe(
        await c.casos.anularMovimiento(e.gerente, {
          clave: nuevoId(),
          movimientoId: t.movimientoId,
          detalle: "Fue al depósito equivocado",
        }),
      );
      expect(anulacion.yaExistia).toBe(false);
      expect(await movimiento(anulacion.anulacionId)).toMatchObject({
        clase: "ANULACION",
        motivo: "ANULACION",
        anula_a: t.movimientoId,
        deposito_id: a.dep,
        detalle: "Fue al depósito equivocado",
        accion: "stock.anular",
      });
      const original = await renglones(t.movimientoId);
      const espejo = await renglones(anulacion.anulacionId);
      expect(espejo.map((r) => [r["deposito_id"], r["articulo_id"], r["cantidad"]]).sort()).toEqual(
        original
          .map((r) => [
            r["deposito_id"],
            r["articulo_id"],
            String(r["cantidad"]).startsWith("-")
              ? String(r["cantidad"]).slice(1)
              : `-${String(r["cantidad"])}`,
          ])
          .sort(),
      );
      expect(await c.existencia(a.dep, a.articulo)).toBe("10.0000");
      expect(await c.existencia(destino, a.articulo)).toBe("0.0000");
    });

    it("no anula lo que no existe, ni lo de otro módulo, ni una anulación, ni un ajuste por conteo; el detalle es obligatorio", async () => {
      const a = await conExistencia("10");
      const m = valorDe(await entrar(a.producto, a.dep, "1"));
      const anular = (movimientoId: string, detalle = "Error de carga") =>
        c.casos.anularMovimiento(e.gerente, {
          clave: nuevoId(),
          movimientoId,
          detalle,
        });
      expect(await anular(nuevoId())).toEqual({ ok: false, error: "MOVIMIENTO_NO_ENCONTRADO" });
      expect(await anular("no-es-un-uuid")).toEqual({
        ok: false,
        error: "MOVIMIENTO_NO_ENCONTRADO",
      });
      expect(await anular(m.movimientoId, "")).toEqual({ ok: false, error: "DETALLE_REQUERIDO" });
      // Lo que viene de otro módulo (una venta) lo revierte su módulo.
      const venta = await c.ventaPorSql({
        empresa: e.empresa,
        depositoId: a.dep,
        articuloId: a.articulo,
        persona: e.personaDelGerente,
      });
      expect(await anular(venta.movimientoId)).toEqual({
        ok: false,
        error: "MOVIMIENTO_NO_ANULABLE",
      });
      const anulacion = valorDe(await anular(m.movimientoId));
      expect(await anular(anulacion.anulacionId)).toEqual({
        ok: false,
        error: "MOVIMIENTO_NO_ANULABLE",
      });
    });

    it("anular una entrada ya consumida deja el saldo en negativo en vez de frenarse", async () => {
      const a = await conExistencia("1");
      const m = valorDe(await entrar(a.producto, a.dep, "2"));
      valorDe(await sacar(a.producto, a.dep, "3"));
      valorDe(
        await c.casos.anularMovimiento(e.gerente, {
          clave: nuevoId(),
          movimientoId: m.movimientoId,
          detalle: "Error de carga",
        }),
      );
      expect(await c.existencia(a.dep, a.articulo)).toBe("-2.0000");
    });
  });

  // =============================================================================================
  describe("P21: la fecha de negocio y la jornada vigente (corte 04:00)", () => {
    it("un movimiento a las 02:00 con corte 04:00 queda en la jornada anterior, y cambiar el corte después NO cambia la ya sellada", async () => {
      const sucursal = await sucursalDeBase(c.dueno, e.empresa, { corte: "04:00" });
      const dep = await c.deposito(e, { sucursal });
      const a = await c.articulo(e);
      const ahora = new Date("2026-11-09T05:00:00Z"); // 02:00 en Buenos Aires
      const contexto = { ...e.gerente, ahora };
      const r = valorDe(
        await c.casos.registrarEntrada(contexto, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [pedido(a.producto, "1")],
        }),
      );
      const zona = (
        await c.filas<{ zona_horaria: string }>("select zona_horaria from empresa where id = $1", [
          e.empresa,
        ])
      )[0]?.zona_horaria as string;
      const esperada = fechaDeNegocio(ahora, zona, "04:00");
      expect(esperada.ok && esperada.valor).toBe("2026-11-08");

      expect(
        (
          await c.filas(
            "select fecha_negocio::text as f from renglon_de_movimiento where movimiento_id = $1",
            [r.movimientoId],
          )
        )[0],
      ).toEqual({ f: "2026-11-08" });
      await c.dueno.query("update sucursal set hora_de_corte = '00:00' where id = $1", [sucursal]);
      expect(
        (
          await c.filas("select fecha_negocio::text as f from movimiento_de_stock where id = $1", [
            r.movimientoId,
          ])
        )[0],
      ).toEqual({ f: "2026-11-08" });
      // Con el corte nuevo, el mismo instante ya es de la jornada del 9.
      const otra = valorDe(
        await c.casos.registrarEntrada(contexto, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [pedido(a.producto, "1")],
        }),
      );
      expect(
        (
          await c.filas("select fecha_negocio::text as f from movimiento_de_stock where id = $1", [
            otra.movimientoId,
          ])
        )[0],
      ).toEqual({ f: "2026-11-09" });
    });

    it("`hechoEn` puede ser de la jornada vigente pero no anterior a su inicio (S-2) ni posterior al ahora", async () => {
      const sucursal = await sucursalDeBase(c.dueno, e.empresa, { corte: "04:00" });
      const dep = await c.deposito(e, { sucursal });
      const a = await c.articulo(e);
      // La jornada del 8 empezó el 8 a las 04:00 locales (07:00Z) y vale hasta el 9 a las 04:00 locales.
      const contexto = { ...e.gerente, ahora: new Date("2026-11-09T05:00:00Z") };
      const con = (hechoEn: Date) =>
        c.casos.registrarEntrada(contexto, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          hechoEn,
          renglones: [pedido(a.producto, "1")],
        });
      expect(await con(new Date("2026-11-08T06:59:00Z"))).toEqual({
        ok: false,
        error: "FECHA_PASADA_NO_ADMITIDA",
      });
      expect(await con(new Date("2026-11-01T12:00:00Z"))).toEqual({
        ok: false,
        error: "FECHA_PASADA_NO_ADMITIDA",
      });
      expect(await con(new Date("1999-01-01T00:00:00Z"))).toEqual({
        ok: false,
        error: "FECHA_PASADA_NO_ADMITIDA",
      });
      expect(await con(new Date("2026-11-09T05:00:01Z"))).toEqual({
        ok: false,
        error: "FECHA_FUTURA_NO_ADMITIDA",
      });
      expect(await con(new Date("invalida"))).toEqual({
        ok: false,
        error: "FECHA_FUTURA_NO_ADMITIDA",
      });
      const justo = valorDe(await con(new Date("2026-11-08T07:00:00Z")));
      expect((await movimiento(justo.movimientoId))?.["hecho_en"]).toEqual(
        new Date("2026-11-08T07:00:00Z"),
      );
      expect(
        (
          await c.filas("select fecha_negocio::text as f from movimiento_de_stock where id = $1", [
            justo.movimientoId,
          ])
        )[0],
      ).toEqual({ f: "2026-11-08" });
      expect(await c.existencia(dep, a.articulo)).toBe("1.0000");
    });
  });

  // =============================================================================================
  describe("P22: cuarentena y rechazo no suman a lo disponible", () => {
    it("no reciben entradas ni salidas (solo transferencia, ajuste o anulación) y las existencias dicen su uso", async () => {
      const normal = await conExistencia("10");
      const cuarentena = await c.deposito(e, { uso: "CUARENTENA" });
      const rechazo = await c.deposito(e, { uso: "RECHAZO" });
      for (const dep of [cuarentena, rechazo]) {
        expect(await entrar(normal.producto, dep, "1")).toEqual({
          ok: false,
          error: "MOTIVO_NO_PERMITIDO",
        });
        expect(await sacar(normal.producto, dep, "1")).toEqual({
          ok: false,
          error: "MOTIVO_NO_PERMITIDO",
        });
      }
      const mover = (destinoId: string, cantidad: string) =>
        c.casos.transferir(e.gerente, {
          clave: nuevoId(),
          origenId: normal.dep,
          destinoId,
          renglones: [pedido(normal.producto, cantidad)],
        });
      const aCuarentena = valorDe(await mover(cuarentena, "3"));
      valorDe(await mover(rechazo, "2"));
      valorDe(
        await c.casos.ajustar(e.gerente, {
          clave: nuevoId(),
          depositoId: cuarentena,
          detalle: "Se rompió en cuarentena",
          renglones: [{ ...pedido(normal.producto, "1"), sentido: "RESTA" }],
        }),
      );
      const filas = valorDe(await c.consultas.existencias(e.gerente, {})).existencias.filter(
        (f) => f.articuloId === normal.articulo,
      );
      expect(filas.map((f) => [f.uso, f.existencia]).sort()).toEqual(
        [
          ["CUARENTENA", "2.0000"],
          ["NORMAL", "5.0000"],
          ["RECHAZO", "2.0000"],
        ].sort(),
      );
      // «Disponible» es lo de los depósitos de uso normal: cuarentena y rechazo no suman.
      const disponible = filas
        .filter((f) => f.uso === "NORMAL")
        .reduce((suma, f) => suma + Number(f.existencia), 0);
      expect(disponible).toBe(5);
      // La anulación vuelve a la cuarentena lo que salió de ella por la transferencia.
      valorDe(
        await c.casos.anularMovimiento(e.gerente, {
          clave: nuevoId(),
          movimientoId: aCuarentena.movimientoId,
          detalle: "Fue a cuarentena por error",
        }),
      );
      expect(await c.existencia(cuarentena, normal.articulo)).toBe("-1.0000");
      expect(await c.existencia(normal.dep, normal.articulo)).toBe("8.0000");
    });
  });

  // =============================================================================================
  describe("P16: el libro es solo inserción y el saldo no se escribe desde la aplicación", () => {
    /** Una sentencia con el rol real de la aplicación y un contexto firmado: lo que la base rechaza vuelve como error de persistencia. */
    const comoApp = (sentencia: ReturnType<typeof sql>) =>
      c.entorno.ejecutar({ contexto: e.gerente }, async (tx) => {
        await sentencia.execute(tx.db);
        return ok(null);
      });

    it("UPDATE, DELETE y TRUNCATE sobre el libro, sus renglones y los registros de conteo y versiones de composición los rechaza la base", async () => {
      const a = await conExistencia("10");
      const m = valorDe(await entrar(a.producto, a.dep, "1"));
      const antes = await c.filas("select * from movimiento_de_stock where id = $1", [
        m.movimientoId,
      ]);
      const renglonesAntes = await renglones(m.movimientoId);
      const sentencias = [
        sql`update movimiento_de_stock set detalle = 'cambiado' where id = ${m.movimientoId}`,
        sql`update movimiento_de_stock set motivo = 'MERMA' where id = ${m.movimientoId}`,
        sql`delete from movimiento_de_stock where id = ${m.movimientoId}`,
        sql`truncate table movimiento_de_stock`,
        sql`update renglon_de_movimiento set cantidad = 999 where movimiento_id = ${m.movimientoId}`,
        sql`delete from renglon_de_movimiento where movimiento_id = ${m.movimientoId}`,
        sql`truncate table renglon_de_movimiento`,
        sql`update conteo_registro set cantidad_contada = 1`,
        sql`delete from conteo_registro`,
        sql`truncate table conteo_registro`,
        sql`update composicion set rinde = 2`,
        sql`delete from composicion`,
        sql`truncate table composicion`,
        sql`update componente_de_composicion set cantidad = 2`,
        sql`delete from componente_de_composicion`,
        sql`truncate table componente_de_composicion`,
      ];
      for (const [indice, sentencia] of sentencias.entries()) {
        expect((await comoApp(sentencia)).ok, `sentencia ${indice}`).toBe(false);
      }
      expect(
        await c.filas("select * from movimiento_de_stock where id = $1", [m.movimientoId]),
      ).toEqual(antes);
      expect(await renglones(m.movimientoId)).toEqual(renglonesAntes);
    });

    it("`saldo_de_stock` no se escribe desde la aplicación (ni INSERT, ni UPDATE, ni DELETE, ni TRUNCATE): solo lo mueve el libro", async () => {
      const a = await conExistencia("10");
      const b = await c.articulo(e);
      const sentencias = [
        sql`insert into saldo_de_stock (empresa_id, deposito_id, articulo_id, existencia) values (${e.empresa}, ${a.dep}, ${b.articulo}, 5)`,
        sql`update saldo_de_stock set existencia = 999 where deposito_id = ${a.dep} and articulo_id = ${a.articulo}`,
        sql`delete from saldo_de_stock where deposito_id = ${a.dep}`,
        sql`truncate table saldo_de_stock`,
      ];
      for (const [indice, sentencia] of sentencias.entries()) {
        expect((await comoApp(sentencia)).ok, `sentencia ${indice}`).toBe(false);
      }
      expect(await c.existencia(a.dep, a.articulo)).toBe("10.0000");
      expect(await c.existencia(a.dep, b.articulo)).toBe("0");
    });
  });

  // =============================================================================================
  describe("consultas", () => {
    it("existencias: filtra por depósito, sucursal, texto y negativas, y el operador solo ve lo de su sucursal", async () => {
      const emp = await c.escenario();
      const central = await c.deposito(emp);
      const norte = await c.deposito(emp, { sucursal: emp.otraSucursal });
      const pizza = await c.articulo(emp);
      const queso = await c.articulo(emp);
      await c.dueno.query(
        "update producto set nombre = 'Zzqueso', nombre_clave = 'zzqueso' where id = $1",
        [queso.producto],
      );
      const mover = (producto: string, depositoId: string, cantidad: string) =>
        c.casos.registrarEntrada(emp.gerente, {
          clave: nuevoId(),
          depositoId,
          motivo: "COMPRA",
          renglones: [pedido(producto, cantidad)],
        });
      valorDe(await mover(pizza.producto, central, "4"));
      valorDe(await mover(queso.producto, central, "2"));
      valorDe(await mover(pizza.producto, norte, "7"));
      valorDe(
        await c.casos.registrarSalida(emp.gerente, {
          clave: nuevoId(),
          depositoId: central,
          motivo: "MERMA",
          renglones: [pedido(queso.producto, "5")],
        }),
      );
      const todas = valorDe(await c.consultas.existencias(emp.gerente));
      expect(todas.siguiente).toBeNull();
      expect(
        todas.existencias.map((f) => [f.articuloId, f.depositoId, f.existencia]).sort(),
      ).toEqual(
        [
          [pizza.articulo, central, "4.0000"],
          [queso.articulo, central, "-3.0000"],
          [pizza.articulo, norte, "7.0000"],
        ].sort(),
      );
      expect(todas.existencias[0]).toMatchObject({ unidadId: "UNIDAD", uso: "NORMAL" });
      const deNorte = valorDe(
        await c.consultas.existencias(emp.gerente, { sucursalId: emp.otraSucursal }),
      );
      expect(deNorte.existencias.map((f) => f.depositoId)).toEqual([norte]);
      expect(
        valorDe(await c.consultas.existencias(emp.gerente, { depositoId: central })).existencias,
      ).toHaveLength(2);
      const negativas = valorDe(await c.consultas.existenciasNegativas(emp.gerente));
      expect(negativas.existencias.map((f) => [f.articuloId, f.existencia])).toEqual([
        [queso.articulo, "-3.0000"],
      ]);
      expect(
        valorDe(await c.consultas.existencias(emp.gerente, { soloNegativas: true })).existencias,
      ).toHaveLength(1);
      expect(
        valorDe(await c.consultas.existencias(emp.gerente, { texto: "zzq" })).existencias,
      ).toHaveLength(1);
      expect(
        valorDe(await c.consultas.existencias(emp.gerente, { texto: "ZZQ" })).existencias,
      ).toHaveLength(1);
      expect(
        valorDe(await c.consultas.existencias(emp.gerente, { texto: "%" })).existencias,
      ).toHaveLength(0);
      // El operador (asignado a la sucursal central) no ve la de Norte, pida lo que pida.
      const delOperador = valorDe(await c.consultas.existencias(emp.operador));
      expect(delOperador.existencias.every((f) => f.depositoId === central)).toBe(true);
      expect(
        valorDe(await c.consultas.existencias(emp.operador, { depositoId: norte })).existencias,
      ).toEqual([]);
      expect(
        valorDe(await c.consultas.existencias(emp.operador, { sucursalId: emp.otraSucursal }))
          .existencias,
      ).toEqual([]);
      // Un filtro mal formado da una página vacía.
      for (const entrada of [
        { depositoId: "x" },
        { sucursalId: "x" },
        { texto: "x".repeat(500) },
        { despuesDe: { nombreClave: "a", articuloId: "x", depositoId: "y" } },
      ]) {
        expect(valorDe(await c.consultas.existencias(emp.gerente, entrada)).existencias).toEqual(
          [],
        );
      }
    });

    it("existencias: pagina por cursor sin repetir ni saltear filas", async () => {
      const emp = await c.escenario();
      const dep = await c.deposito(emp);
      const articulos = [];
      for (let i = 0; i < 53; i += 1) articulos.push(await c.articulo(emp));
      valorDe(
        await c.casos.registrarEntrada(emp.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "CARGA_INICIAL",
          renglones: articulos.map((a) => pedido(a.producto, "1")),
        }),
      );
      const primera = valorDe(await c.consultas.existencias(emp.gerente));
      expect(primera.existencias).toHaveLength(50);
      expect(primera.siguiente).not.toBeNull();
      const segunda = valorDe(
        await c.consultas.existencias(emp.gerente, { despuesDe: primera.siguiente ?? undefined }),
      );
      expect(segunda.existencias).toHaveLength(3);
      expect(segunda.siguiente).toBeNull();
      const ids = [...primera.existencias, ...segunda.existencias].map((f) => f.articuloId);
      expect(new Set(ids).size).toBe(53);
      expect([...ids].sort()).toEqual(articulos.map((a) => a.articulo).sort());
    });

    it("libroDeArticulo: renglones por fecha de negocio con el saldo corrido, clase, motivo, autor y quién anuló; pagina por cursor; el operador no ve un depósito ajeno", async () => {
      const emp = await c.escenario();
      const dep = await c.deposito(emp);
      const norte = await c.deposito(emp, { sucursal: emp.otraSucursal });
      const a = await c.articulo(emp);
      const ids: string[] = [];
      const carga = async (cantidad: string) => {
        const r = valorDe(
          await c.casos.registrarEntrada(emp.gerente, {
            clave: nuevoId(),
            depositoId: dep,
            motivo: "COMPRA",
            renglones: [pedido(a.producto, cantidad)],
          }),
        );
        ids.push(r.movimientoId);
        return r.movimientoId;
      };
      const primero = await carga("1");
      for (let i = 0; i < 50; i += 1) await carga("1");
      valorDe(
        await c.casos.anularMovimiento(emp.gerente, {
          clave: nuevoId(),
          movimientoId: primero,
          detalle: "Error de carga",
        }),
      );
      const rango = {
        articuloId: a.articulo,
        depositoId: dep,
        desde: "2026-10-01",
        hasta: "2026-10-31",
      };
      const pagina1 = valorDe(await c.consultas.libroDeArticulo(emp.gerente, rango));
      expect(pagina1.renglones).toHaveLength(50);
      expect(pagina1.siguiente).not.toBeNull();
      const pagina2 = valorDe(
        await c.consultas.libroDeArticulo(emp.gerente, {
          ...rango,
          despuesDe: pagina1.siguiente ?? undefined,
        }),
      );
      expect(pagina2.renglones).toHaveLength(2);
      expect(pagina2.siguiente).toBeNull();
      const todos = [...pagina1.renglones, ...pagina2.renglones];
      expect(new Set(todos.map((r) => `${r.movimientoId}|${r.numero}`)).size).toBe(52);
      // El saldo corrido sube de a uno y la anulación del primero lo baja.
      expect(todos.map((r) => r.saldo).at(-1)).toBe("50.0000");
      const delPrimero = todos.find((r) => r.movimientoId === primero);
      expect(delPrimero).toMatchObject({
        clase: "ENTRADA",
        motivo: "COMPRA",
        registradoPor: emp.personaDelGerente,
        cantidad: "1.0000",
        origenTipo: "MANUAL",
        anuladoPor: expect.any(String) as string,
      });
      expect(todos.filter((r) => r.clase === "ANULACION")).toHaveLength(1);
      // Fuera de la ventana de fechas no hay nada; mal formado, tampoco; el operador no ve un depósito ajeno.
      expect(
        valorDe(
          await c.consultas.libroDeArticulo(emp.gerente, {
            ...rango,
            desde: "2027-01-01",
            hasta: "2027-01-31",
          }),
        ).renglones,
      ).toEqual([]);
      expect(
        valorDe(
          await c.consultas.libroDeArticulo(emp.gerente, {
            ...rango,
            desde: "2026-10-31",
            hasta: "2026-10-01",
          }),
        ).renglones,
      ).toEqual([]);
      expect(
        valorDe(await c.consultas.libroDeArticulo(emp.gerente, { ...rango, desde: "ayer" }))
          .renglones,
      ).toEqual([]);
      expect(
        valorDe(await c.consultas.libroDeArticulo(emp.gerente, { ...rango, depositoId: "x" }))
          .renglones,
      ).toEqual([]);
      expect(
        valorDe(await c.consultas.libroDeArticulo(emp.operador, rango)).renglones.length,
      ).toBeGreaterThan(0);
      valorDe(
        await c.casos.registrarEntrada(emp.gerente, {
          clave: nuevoId(),
          depositoId: norte,
          motivo: "COMPRA",
          renglones: [pedido(a.producto, "1")],
        }),
      );
      expect(
        valorDe(await c.consultas.libroDeArticulo(emp.operador, { ...rango, depositoId: norte }))
          .renglones,
      ).toEqual([]);
      expect(
        valorDe(await c.consultas.libroDeArticulo(emp.gerente, { ...rango, depositoId: norte }))
          .renglones,
      ).toHaveLength(1);
    });

    it("fichaDeMovimiento y movimientosPorOrigen: cabecera sin clave ni huella, renglones con su producto y la anulación; lo ajeno al alcance no se ve", async () => {
      const emp = await c.escenario();
      const central = await c.deposito(emp);
      const norte = await c.deposito(emp, { sucursal: emp.otraSucursal });
      const a = await c.articulo(emp);
      valorDe(
        await c.casos.registrarEntrada(emp.gerente, {
          clave: nuevoId(),
          depositoId: central,
          motivo: "COMPRA",
          renglones: [pedido(a.producto, "5")],
        }),
      );
      const t = valorDe(
        await c.casos.transferir(emp.gerente, {
          clave: nuevoId(),
          origenId: central,
          destinoId: norte,
          renglones: [pedido(a.producto, "2")],
        }),
      );
      const ficha = valorDe(
        await c.consultas.fichaDeMovimiento(emp.gerente, { movimientoId: t.movimientoId }),
      );
      expect(ficha).toMatchObject({
        movimiento: {
          id: t.movimientoId,
          clase: "TRANSFERENCIA",
          depositoId: central,
          accion: "stock.transferir",
          registradoPor: emp.personaDelGerente,
        },
        anulacion: null,
      });
      expect(ficha?.movimiento).not.toHaveProperty("clave");
      expect(ficha?.movimiento).not.toHaveProperty("huella");
      expect(ficha?.renglones.map((r) => [r.depositoId, r.productoId, r.cantidad]).sort()).toEqual(
        [
          [central, a.producto, "-2.0000"],
          [norte, a.producto, "2.0000"],
        ].sort(),
      );
      // Una transferencia entre dos sucursales solo la ve quien tiene las dos.
      expect(
        valorDe(
          await c.consultas.fichaDeMovimiento(emp.operador, { movimientoId: t.movimientoId }),
        ),
      ).toBeNull();
      expect(
        valorDe(await c.consultas.fichaDeMovimiento(emp.gerente, { movimientoId: nuevoId() })),
      ).toBeNull();
      expect(
        valorDe(await c.consultas.fichaDeMovimiento(emp.gerente, { movimientoId: "x" })),
      ).toBeNull();
      const anulacion = valorDe(
        await c.casos.anularMovimiento(emp.gerente, {
          clave: nuevoId(),
          movimientoId: t.movimientoId,
          detalle: "Error",
        }),
      );
      const conAnulacion = valorDe(
        await c.consultas.fichaDeMovimiento(emp.gerente, { movimientoId: t.movimientoId }),
      );
      expect(conAnulacion?.anulacion).toMatchObject({
        id: anulacion.anulacionId,
        detalle: "Error",
        registradoPor: emp.personaDelGerente,
      });

      // Por origen: la salida de un ejemplar y lo que haya de ese origen.
      const venta = await c.ventaPorSql({
        empresa: emp.empresa,
        depositoId: central,
        articuloId: a.articulo,
        persona: emp.personaDelGerente,
      });
      const ejemplar = venta.ejemplarId;
      const delOrigen = valorDe(
        await c.consultas.movimientosPorOrigen(emp.operador, {
          origenTipo: "EJEMPLAR_DE_TICKET",
          origenId: ejemplar,
        }),
      );
      expect(delOrigen.map((f) => f.movimiento.id)).toEqual([venta.movimientoId]);
      expect(
        valorDe(
          await c.consultas.movimientosPorOrigen(emp.gerente, {
            origenTipo: "MANUAL",
            origenId: ejemplar,
          }),
        ),
      ).toEqual([]);
      expect(
        valorDe(
          await c.consultas.movimientosPorOrigen(emp.gerente, {
            origenTipo: "EJEMPLAR_DE_TICKET",
            origenId: "x",
          }),
        ),
      ).toEqual([]);
    });

    it("verificarSaldos es del gerente (stock.verificar_saldos) y da vacío cuando el saldo es la suma del libro", async () => {
      const emp = await c.escenario();
      const dep = await c.deposito(emp);
      const a = await c.articulo(emp);
      valorDe(
        await c.casos.registrarEntrada(emp.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [pedido(a.producto, "5")],
        }),
      );
      expect(valorDe(await c.consultas.verificarSaldos(emp.gerente))).toEqual([]);
      expect(await c.consultas.verificarSaldos(emp.administrador)).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect(await c.consultas.verificarSaldos(emp.operador)).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      for (const consulta of [
        c.consultas.existencias(emp.operador),
        c.consultas.existencias(emp.administrador),
      ]) {
        expect((await consulta).ok).toBe(true);
      }
    });
  });
});
