import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { codigoDe } from "./concurrencia-apoyo";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * E9-T7: la ficha de compra del proveedor (puntos de venta, comprobantes y pedidos) y las presentaciones, contra la base real. Permisos por rol (el operador
 * pide, el gerente y el administrador editan y resuelven), idempotencia (`yaEstaba`), concurrencia (aprobar y rechazar el mismo pedido a la vez: gana uno; dos
 * pedidos iguales: uno pendiente), la letra esperada que queda congelada y el aislamiento entre empresas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: ficha del proveedor, pedidos y presentaciones", () => {
  let c: MontajeDeCompras;
  let e: EscenarioDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    e = await c.escenario();
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const fichaDe = async (parteId: string) =>
    valorDe(await c.consultas.fichaDelProveedorParaCompras(e.operador, { parteId }));
  const auditorias = async (accion: string) => (await c.auditoria(e.empresa, accion)).length;

  // =============================================================================================
  describe("puntos de venta y comprobantes de la ficha", () => {
    it("el gerente y el administrador agregan y dejan de usar; queda auditado quién y qué", async () => {
      const p = await c.proveedor(e.operador);
      expect(
        valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: p, numero: 5 })),
      ).toEqual({
        yaEstaba: false,
      });
      expect(
        valorDe(
          await c.casos.agregarComprobante(e.administrador, { parteId: p, tipo: "FACTURA_A" }),
        ),
      ).toEqual({ yaEstaba: false });
      expect((await fichaDe(p)).puntosDeVenta).toEqual([{ numero: 5, activo: true }]);
      expect((await fichaDe(p)).comprobantes).toEqual([{ tipo: "FACTURA_A", activo: true }]);
      expect(
        valorDe(await c.casos.dejarDeUsarPuntoDeVenta(e.gerente, { parteId: p, numero: 5 })),
      ).toEqual({
        yaEstaba: false,
      });
      expect((await fichaDe(p)).puntosDeVenta).toEqual([{ numero: 5, activo: false }]);
      const auditoria = await c.auditoria(e.empresa, "FICHA_PUNTO_DE_VENTA_AGREGADO");
      expect(auditoria.at(-1)).toMatchObject({
        actor_persona_id: e.gerente.personaId,
        entidad: "ficha_de_compra",
        entidad_id: p,
        despues: { numero: 5 },
      });
    });

    it("I8: agregar dos veces el mismo punto de venta o comprobante, o dejar de usar uno ya apagado, es ok y la segunda no escribe ni audita", async () => {
      const p = await c.proveedor(e.operador);
      valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: p, numero: 7 }));
      const antes = await auditorias("FICHA_PUNTO_DE_VENTA_AGREGADO");
      expect(
        valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: p, numero: 7 })),
      ).toEqual({
        yaEstaba: true,
      });
      expect(await auditorias("FICHA_PUNTO_DE_VENTA_AGREGADO")).toBe(antes);
      valorDe(await c.casos.agregarComprobante(e.gerente, { parteId: p, tipo: "FACTURA_B" }));
      expect(
        valorDe(await c.casos.agregarComprobante(e.gerente, { parteId: p, tipo: "FACTURA_B" })),
      ).toEqual({ yaEstaba: true });
      valorDe(await c.casos.dejarDeUsarPuntoDeVenta(e.gerente, { parteId: p, numero: 7 }));
      const apagados = await auditorias("FICHA_PUNTO_DE_VENTA_APAGADO");
      expect(
        valorDe(await c.casos.dejarDeUsarPuntoDeVenta(e.gerente, { parteId: p, numero: 7 })),
      ).toEqual({
        yaEstaba: true,
      });
      expect(
        valorDe(await c.casos.dejarDeUsarPuntoDeVenta(e.gerente, { parteId: p, numero: 9 })),
      ).toEqual({
        yaEstaba: true,
      });
      expect(await auditorias("FICHA_PUNTO_DE_VENTA_APAGADO")).toBe(apagados);
      expect(
        valorDe(await c.casos.dejarDeUsarComprobante(e.gerente, { parteId: p, tipo: "FACTURA_C" })),
      ).toEqual({ yaEstaba: true });
      // un punto de venta apagado se reactiva
      expect(
        valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: p, numero: 7 })),
      ).toEqual({
        yaEstaba: false,
      });
      expect((await fichaDe(p)).puntosDeVenta).toEqual([{ numero: 7, activo: true }]);
    });

    it("rechaza un punto de venta fuera de 1 a 99998, un tipo que no es de los nueve y un proveedor que no existe o es de otro rol", async () => {
      const p = await c.proveedor(e.operador);
      for (const numero of [0, -1, 99999, 1.5, Number.NaN]) {
        expect(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: p, numero })).toEqual({
          ok: false,
          error: "PUNTO_DE_VENTA_INVALIDO",
        });
      }
      expect(
        await c.casos.agregarComprobante(e.gerente, { parteId: p, tipo: "FACTURA_Z" }),
      ).toEqual({
        ok: false,
        error: "TIPO_DE_COMPROBANTE_INVALIDO",
      });
      expect(
        await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: nuevoId(), numero: 1 }),
      ).toEqual({ ok: false, error: "PROVEEDOR_NO_ENCONTRADO" });
      expect(
        await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: "no-es-uuid", numero: 1 }),
      ).toEqual({
        ok: false,
        error: "PROVEEDOR_NO_ENCONTRADO",
      });
      const soloCliente = await c.proveedor(e.operador, { roles: ["CUSTOMER"] });
      expect(
        await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: soloCliente, numero: 1 }),
      ).toEqual({
        ok: false,
        error: "PROVEEDOR_NO_ENCONTRADO",
      });
      const inactivo = await c.proveedor(e.operador);
      valorDe(await c.clientes.desactivarParte(e.gerente, { parteId: inactivo }));
      expect(
        await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: inactivo, numero: 1 }),
      ).toEqual({
        ok: false,
        error: "PROVEEDOR_NO_ENCONTRADO",
      });
    });

    it("el operador no edita la ficha (SIN_PERMISO); con el módulo apagado nadie", async () => {
      const p = await c.proveedor(e.operador);
      expect(
        await c.casos.agregarPuntoDeVenta(e.operador, { parteId: p, numero: 3 }),
      ).toMatchObject({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect(
        await c.casos.dejarDeUsarComprobante(e.operador, { parteId: p, tipo: "FACTURA_A" }),
      ).toMatchObject({
        ok: false,
        error: "SIN_PERMISO",
      });
      c.apagarModulo("compras");
      try {
        expect(
          await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: p, numero: 3 }),
        ).toMatchObject({
          ok: false,
        });
      } finally {
        c.encenderModulo("compras");
      }
      expect((await fichaDe(p)).puntosDeVenta).toEqual([]);
    });

    it("la letra esperada sale de la condición frente al IVA al nacer la ficha y queda congelada (R3, parte de la ficha)", async () => {
      const inscripto = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
      const monotributo = await c.proveedor(e.operador, { condicionIva: "MONOTRIBUTO" });
      const sinCondicion = await c.proveedor(e.operador);
      for (const p of [inscripto, monotributo, sinCondicion]) {
        valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: p, numero: 1 }));
      }
      expect((await fichaDe(inscripto)).letraEsperada).toBe("A");
      expect((await fichaDe(monotributo)).letraEsperada).toBe("C");
      expect((await fichaDe(sinCondicion)).letraEsperada).toBeNull();
      const ficha = valorDe(
        await c.clientes.editarParte(e.gerente, {
          parteId: inscripto,
          versionEsperada: 1,
          cambios: { condicionIva: "MONOTRIBUTO" },
        }),
      );
      expect(ficha.yaEstaba).toBe(false);
      valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: inscripto, numero: 2 }));
      expect((await fichaDe(inscripto)).letraEsperada).toBe("A");
    });

    it("una empresa B no ve ni toca la ficha de la A, ni con la misma parte (R6)", async () => {
      const otra = await c.escenario();
      const p = await c.proveedor(e.operador);
      valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: p, numero: 11 }));
      expect(await c.casos.agregarPuntoDeVenta(otra.gerente, { parteId: p, numero: 12 })).toEqual({
        ok: false,
        error: "PROVEEDOR_NO_ENCONTRADO",
      });
      const vista = valorDe(
        await c.consultas.fichaDelProveedorParaCompras(otra.gerente, { parteId: p }),
      );
      expect(vista.existe).toBe(false);
      expect(vista.puntosDeVenta).toEqual([]);
      expect(
        await c.contar("select count(*) as n from punto_de_venta_de_la_ficha where parte_id = $1", [
          p,
        ]),
      ).toBe(1);
    });
  });

  // =============================================================================================
  describe("pedidos de ficha", () => {
    it("el operador pide, el gerente aprueba y el punto de venta queda activo; quedan quién y cuándo", async () => {
      const p = await c.proveedor(e.operador);
      const pedido = valorDe(
        await c.casos.pedirPuntoDeVenta(e.operador, { parteId: p, numero: 21 }),
      );
      expect(pedido.yaEstaba).toBe(false);
      expect(pedido.pedidoId).not.toBeNull();
      expect((await fichaDe(p)).pedidosPendientes).toMatchObject([
        {
          id: pedido.pedidoId,
          objeto: "PUNTO_DE_VENTA",
          valor: "21",
          pedidoPor: e.operador.personaId,
        },
      ]);
      expect((await fichaDe(p)).puntosDeVenta).toEqual([]);
      expect(
        valorDe(
          await c.casos.resolverPedido(e.gerente, {
            pedidoId: pedido.pedidoId as string,
            decision: "APROBAR",
          }),
        ),
      ).toEqual({ yaEstaba: false });
      const ficha = await fichaDe(p);
      expect(ficha.puntosDeVenta).toEqual([{ numero: 21, activo: true }]);
      expect(ficha.pedidosPendientes).toEqual([]);
      const filas = await c.filas<{ estado: string; resuelto_por: string; pedido_por: string }>(
        "select estado, resuelto_por, pedido_por from pedido_de_ficha where id = $1",
        [pedido.pedidoId],
      );
      expect(filas[0]).toMatchObject({
        estado: "APROBADO",
        resuelto_por: e.gerente.personaId,
        pedido_por: e.operador.personaId,
      });
    });

    it("rechazar deja el pedido resuelto y la ficha sin cambios; un comprobante pedido se aprueba igual", async () => {
      const p = await c.proveedor(e.operador);
      const a = valorDe(await c.casos.pedirPuntoDeVenta(e.operador, { parteId: p, numero: 22 }));
      valorDe(
        await c.casos.resolverPedido(e.administrador, {
          pedidoId: a.pedidoId as string,
          decision: "RECHAZAR",
        }),
      );
      expect((await fichaDe(p)).puntosDeVenta).toEqual([]);
      const b = valorDe(
        await c.casos.pedirComprobante(e.operador, { parteId: p, tipo: "NOTA_CREDITO_A" }),
      );
      valorDe(
        await c.casos.resolverPedido(e.gerente, {
          pedidoId: b.pedidoId as string,
          decision: "APROBAR",
        }),
      );
      expect((await fichaDe(p)).comprobantes).toEqual([{ tipo: "NOTA_CREDITO_A", activo: true }]);
    });

    it("I8: el mismo pedido de ficha dos veces es un solo pedido pendiente", async () => {
      const p = await c.proveedor(e.operador);
      const primero = valorDe(
        await c.casos.pedirPuntoDeVenta(e.operador, { parteId: p, numero: 31 }),
      );
      const antes = await auditorias("FICHA_PEDIDO_CREADO");
      const segundo = valorDe(
        await c.casos.pedirPuntoDeVenta(e.gerente, { parteId: p, numero: 31 }),
      );
      expect(segundo).toEqual({ pedidoId: primero.pedidoId, yaEstaba: true });
      expect(await auditorias("FICHA_PEDIDO_CREADO")).toBe(antes);
      const comprobante = valorDe(
        await c.casos.pedirComprobante(e.operador, { parteId: p, tipo: "FACTURA_B" }),
      );
      expect(
        valorDe(await c.casos.pedirComprobante(e.operador, { parteId: p, tipo: "FACTURA_B" })),
      ).toEqual({
        pedidoId: comprobante.pedidoId,
        yaEstaba: true,
      });
      expect(
        await c.contar("select count(*) as n from pedido_de_ficha where parte_id = $1", [p]),
      ).toBe(2);
      // lo que ya está activo en la ficha no se pide
      valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: p, numero: 32 }));
      expect(
        valorDe(await c.casos.pedirPuntoDeVenta(e.operador, { parteId: p, numero: 32 })),
      ).toEqual({
        pedidoId: null,
        yaEstaba: true,
      });
    });

    it("I8: aprobar dos veces el mismo pedido es ok y la segunda no escribe ni audita; en sentido contrario, PEDIDO_YA_RESUELTO", async () => {
      const p = await c.proveedor(e.operador);
      const pedido = valorDe(
        await c.casos.pedirPuntoDeVenta(e.operador, { parteId: p, numero: 41 }),
      );
      const id = pedido.pedidoId as string;
      valorDe(await c.casos.resolverPedido(e.gerente, { pedidoId: id, decision: "APROBAR" }));
      const antes = await auditorias("FICHA_PEDIDO_APROBADO");
      expect(
        valorDe(
          await c.casos.resolverPedido(e.administrador, { pedidoId: id, decision: "APROBAR" }),
        ),
      ).toEqual({
        yaEstaba: true,
      });
      expect(await auditorias("FICHA_PEDIDO_APROBADO")).toBe(antes);
      expect(
        await c.casos.resolverPedido(e.gerente, { pedidoId: id, decision: "RECHAZAR" }),
      ).toEqual({
        ok: false,
        error: "PEDIDO_YA_RESUELTO",
      });
      expect(
        await c.casos.resolverPedido(e.gerente, { pedidoId: nuevoId(), decision: "APROBAR" }),
      ).toEqual({
        ok: false,
        error: "PEDIDO_NO_ENCONTRADO",
      });
      expect(
        await c.casos.resolverPedido(e.gerente, { pedidoId: id, decision: "TAL VEZ" as never }),
      ).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
    });

    it("el operador no resuelve pedidos; el sistema (sin persona) no pide nada", async () => {
      const p = await c.proveedor(e.operador);
      const pedido = valorDe(
        await c.casos.pedirPuntoDeVenta(e.operador, { parteId: p, numero: 51 }),
      );
      expect(
        await c.casos.resolverPedido(e.operador, {
          pedidoId: pedido.pedidoId as string,
          decision: "APROBAR",
        }),
      ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
      expect(
        await c.casos.pedirPuntoDeVenta(
          { ...e.operador, personaId: null },
          { parteId: p, numero: 52 },
        ),
      ).toMatchObject({ ok: false });
    });

    it("C10: aprobar y rechazar el mismo pedido a la vez: gana uno y el otro ve el pedido ya resuelto", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const p = await c.proveedor(e.operador);
        const pedido = valorDe(
          await c.casos.pedirPuntoDeVenta(e.operador, { parteId: p, numero: 60 + ronda }),
        );
        const id = pedido.pedidoId as string;
        c.armarBarrera(2);
        try {
          const resultados = await Promise.all([
            c.casos.resolverPedido(e.gerente, { pedidoId: id, decision: "APROBAR" }),
            c.casos.resolverPedido(e.administrador, { pedidoId: id, decision: "RECHAZAR" }),
          ]);
          expect(resultados.filter((r) => r.ok).length).toBe(1);
          expect(
            resultados
              .filter((r) => !r.ok)
              .every((r) => ["PEDIDO_YA_RESUELTO", "ConcurrenciaAgotada"].includes(codigoDe(r))),
          ).toBe(true);
        } finally {
          c.soltarBarrera();
        }
        const [fila] = await c.filas<{ estado: string }>(
          "select estado from pedido_de_ficha where id = $1",
          [id],
        );
        const activos = (await fichaDe(p)).puntosDeVenta.filter((x) => x.activo).length;
        // nunca queda aprobado sin el punto de venta, ni rechazado con él
        expect(activos).toBe(fila?.estado === "APROBADO" ? 1 : 0);
      }
    });

    it("C10: dos pedidos iguales a la vez dejan un solo pedido pendiente", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const p = await c.proveedor(e.operador);
        c.armarBarrera(2);
        try {
          const resultados = await Promise.all([
            c.casos.pedirPuntoDeVenta(e.operador, { parteId: p, numero: 70 }),
            c.casos.pedirPuntoDeVenta(e.gerente, { parteId: p, numero: 70 }),
          ]);
          expect(resultados.every((r) => r.ok || codigoDe(r) === "ConcurrenciaAgotada")).toBe(true);
          expect(resultados.some((r) => r.ok)).toBe(true);
        } finally {
          c.soltarBarrera();
        }
        expect(
          await c.contar(
            "select count(*) as n from pedido_de_ficha where parte_id = $1 and estado = 'PENDIENTE'",
            [p],
          ),
        ).toBe(1);
      }
    });
  });

  // =============================================================================================
  describe("presentaciones", () => {
    it("el gerente crea una presentación de peso variable y otra de cantidad fija; queda auditado", async () => {
      const producto = await c.producto(e.empresa, { unidadBase: "GRAMO", dimension: "MASA" });
      const caja = valorDe(
        await c.casos.crearPresentacion(e.gerente, {
          productoId: producto,
          nombre: "Caja x 12",
          cantidad: "12000",
          dePesoVariable: false,
        }),
      );
      expect(caja.yaExistia).toBe(false);
      expect(caja.presentacion).toMatchObject({
        nombre: "Caja x 12",
        cantidad: "12000.0000",
        dePesoVariable: false,
        activa: true,
      });
      const pieza = valorDe(
        await c.casos.crearPresentacion(e.administrador, {
          productoId: producto,
          nombre: "Pieza",
          cantidad: "4000",
          dePesoVariable: true,
        }),
      );
      expect(pieza.presentacion.dePesoVariable).toBe(true);
      expect((await c.auditoria(e.empresa, "PRESENTACION_CREADA")).at(-1)).toMatchObject({
        actor_persona_id: e.administrador.personaId,
        entidad_id: pieza.presentacion.id,
      });
    });

    it("I8: crear dos veces la misma presentación devuelve la existente; con otra cantidad, PRESENTACION_REPETIDA", async () => {
      const producto = await c.producto(e.empresa);
      const entrada = {
        productoId: producto,
        nombre: "Bolsa",
        cantidad: "25",
        dePesoVariable: false,
      };
      const primera = valorDe(await c.casos.crearPresentacion(e.gerente, entrada));
      const antes = await auditorias("PRESENTACION_CREADA");
      const segunda = valorDe(
        await c.casos.crearPresentacion(e.gerente, { ...entrada, nombre: "BOLSA" }),
      );
      expect(segunda).toEqual({ presentacion: primera.presentacion, yaExistia: true });
      expect(await auditorias("PRESENTACION_CREADA")).toBe(antes);
      expect(await c.casos.crearPresentacion(e.gerente, { ...entrada, cantidad: "50" })).toEqual({
        ok: false,
        error: "PRESENTACION_REPETIDA",
      });
      expect(
        await c.casos.crearPresentacion(e.gerente, { ...entrada, dePesoVariable: true }),
      ).toEqual({
        ok: false,
        error: "PRESENTACION_REPETIDA",
      });
    });

    it("rechaza un producto que no se compra, inexistente, de otra empresa o con datos inválidos; el operador no edita el catálogo", async () => {
      const vendible = await c.producto(e.empresa, { clase: "VENDIBLE" });
      const entrada = {
        productoId: vendible,
        nombre: "Caja",
        cantidad: "1",
        dePesoVariable: false,
      };
      expect(await c.casos.crearPresentacion(e.gerente, entrada)).toEqual({
        ok: false,
        error: "PRODUCTO_NO_COMPRABLE",
      });
      expect(
        await c.casos.crearPresentacion(e.gerente, { ...entrada, productoId: nuevoId() }),
      ).toEqual({
        ok: false,
        error: "PRODUCTO_NO_ENCONTRADO",
      });
      const otra = await c.escenario();
      const deOtra = await c.producto(otra.empresa);
      expect(
        await c.casos.crearPresentacion(e.gerente, { ...entrada, productoId: deOtra }),
      ).toEqual({
        ok: false,
        error: "PRODUCTO_NO_ENCONTRADO",
      });
      const comprable = await c.producto(e.empresa);
      expect(
        await c.casos.crearPresentacion(e.gerente, {
          ...entrada,
          productoId: comprable,
          nombre: "",
        }),
      ).toEqual({
        ok: false,
        error: "NOMBRE_INVALIDO",
      });
      expect(
        await c.casos.crearPresentacion(e.gerente, {
          ...entrada,
          productoId: comprable,
          cantidad: "0",
        }),
      ).toEqual({
        ok: false,
        error: "CANTIDAD_INVALIDA",
      });
      expect(
        await c.casos.crearPresentacion(e.operador, { ...entrada, productoId: comprable }),
      ).toMatchObject({
        ok: false,
        error: "SIN_PERMISO",
      });
    });

    it("I8: editar una presentación con lo que ya tiene devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar", async () => {
      const producto = await c.producto(e.empresa);
      const creada = valorDe(
        await c.casos.crearPresentacion(e.gerente, {
          productoId: producto,
          nombre: "Pack",
          cantidad: "6",
          dePesoVariable: false,
        }),
      ).presentacion;
      const editada = valorDe(
        await c.casos.editarPresentacion(e.gerente, {
          presentacionId: creada.id,
          nombre: "Pack grande",
          activa: true,
          versionEsperada: creada.version,
        }),
      );
      expect(editada).toMatchObject({
        nombre: "Pack grande",
        cantidad: "6.0000",
        version: creada.version + 1,
      });
      const antes = await auditorias("PRESENTACION_EDITADA");
      const repetida = valorDe(
        await c.casos.editarPresentacion(e.gerente, {
          presentacionId: creada.id,
          nombre: "Pack grande",
          activa: true,
          versionEsperada: creada.version,
        }),
      );
      expect(repetida).toEqual(editada);
      expect(await auditorias("PRESENTACION_EDITADA")).toBe(antes);
      expect(
        await c.casos.editarPresentacion(e.gerente, {
          presentacionId: creada.id,
          nombre: "Otro",
          activa: true,
          versionEsperada: creada.version,
        }),
      ).toEqual({ ok: false, error: "VERSION_DESACTUALIZADA" });
    });

    it("renombrar a un nombre de otra presentación del mismo producto es PRESENTACION_REPETIDA; apagar y reactivar funciona", async () => {
      const producto = await c.producto(e.empresa);
      const a = valorDe(
        await c.casos.crearPresentacion(e.gerente, {
          productoId: producto,
          nombre: "Uno",
          cantidad: "1",
          dePesoVariable: false,
        }),
      ).presentacion;
      valorDe(
        await c.casos.crearPresentacion(e.gerente, {
          productoId: producto,
          nombre: "Dos",
          cantidad: "2",
          dePesoVariable: false,
        }),
      );
      expect(
        await c.casos.editarPresentacion(e.gerente, {
          presentacionId: a.id,
          nombre: "dos",
          activa: true,
          versionEsperada: a.version,
        }),
      ).toEqual({ ok: false, error: "PRESENTACION_REPETIDA" });
      const apagada = valorDe(
        await c.casos.editarPresentacion(e.gerente, {
          presentacionId: a.id,
          nombre: "Uno",
          activa: false,
          versionEsperada: a.version,
        }),
      );
      expect(apagada.activa).toBe(false);
      expect(
        valorDe(
          await c.casos.editarPresentacion(e.administrador, {
            presentacionId: a.id,
            nombre: "Uno",
            activa: true,
            versionEsperada: apagada.version,
          }),
        ).activa,
      ).toBe(true);
      expect(
        await c.casos.editarPresentacion(e.gerente, {
          presentacionId: nuevoId(),
          nombre: "X",
          activa: true,
          versionEsperada: 1,
        }),
      ).toEqual({
        ok: false,
        error: "PRESENTACION_NO_ENCONTRADA",
      });
    });

    it("dos altas iguales a la vez dejan una presentación (la otra devuelve la existente)", async () => {
      for (let ronda = 0; ronda < RONDAS; ronda++) {
        const producto = await c.producto(e.empresa);
        c.armarBarrera(2);
        try {
          const resultados = await Promise.all([
            c.casos.crearPresentacion(e.gerente, {
              productoId: producto,
              nombre: "Doble",
              cantidad: "3",
              dePesoVariable: false,
            }),
            c.casos.crearPresentacion(e.administrador, {
              productoId: producto,
              nombre: "Doble",
              cantidad: "3",
              dePesoVariable: false,
            }),
          ]);
          expect(resultados.every((r) => r.ok || codigoDe(r) === "ConcurrenciaAgotada")).toBe(true);
          expect(resultados.some((r) => r.ok)).toBe(true);
        } finally {
          c.soltarBarrera();
        }
        expect(
          await c.contar(
            "select count(*) as n from presentacion_de_producto where producto_id = $1",
            [producto],
          ),
        ).toBe(1);
      }
    });
  });

  // =============================================================================================
  describe("consultas", () => {
    it("proveedoresDelProducto pide costos.ver: el operador no ve los costos, el gerente sí; una ficha de otra empresa no existe", async () => {
      const producto = await c.producto(e.empresa);
      expect(
        await c.consultas.proveedoresDelProducto(e.operador, { productoId: producto }),
      ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
      expect(
        valorDe(await c.consultas.proveedoresDelProducto(e.gerente, { productoId: producto })),
      ).toEqual([]);
      expect(await c.consultas.proveedoresDelProducto(e.gerente, { productoId: "x" })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      expect(await c.consultas.fichaDelProveedorParaCompras(e.operador, { parteId: "x" })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
    });
  });
});
