import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  montarStock,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E5-T6: conteo físico (abrir, registrar, aplicar y cancelar, y sus consultas a ciegas) contra la base real y con las dependencias reales.
 * Permisos por rol y alcance, validación, el ajuste por diferencia (lo vendido después de contar queda intacto, lo no contado no cambia),
 * idempotencia (P12) y aislamiento entre empresas. La concurrencia (P5 y P6) está en `stock-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("stock: conteo físico", () => {
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

  const pedido = (producto: string, cantidad: string, unidadId = "UNIDAD") => ({
    productoId: producto,
    cantidad,
    unidadId,
  });
  /** Un depósito con artículos que tienen la existencia pedida (por el caso de uso real). */
  const conExistencias = async (
    cantidades: readonly string[],
    datos: Parameters<MontajeDeStock["deposito"]>[1] = {},
  ) => {
    const dep = await c.deposito(e, datos);
    const articulos = [];
    for (const cantidad of cantidades) {
      const a = await c.articulo(e);
      if (cantidad !== "0") {
        valorDe(
          await c.casos.registrarEntrada(e.gerente, {
            clave: nuevoId(),
            depositoId: dep,
            motivo: "CARGA_INICIAL",
            renglones: [pedido(a.producto, cantidad)],
          }),
        );
      }
      articulos.push(a);
    }
    return { dep, articulos };
  };
  const abrir = async (dep: string, quien = e.gerente) =>
    valorDe(await c.casos.abrirConteo(quien, { id: nuevoId(), depositoId: dep })).conteoId;
  const contar = (
    conteoId: string,
    producto: string,
    cantidad: string,
    quien = e.gerente,
    unidadId = "UNIDAD",
  ) =>
    c.casos.registrarConteo(quien, {
      id: nuevoId(),
      conteoId,
      productoId: producto,
      cantidadContada: cantidad,
      unidadId,
    });
  const conteo = async (id: string) =>
    (await c.filas("select * from conteo_fisico where id = $1", [id]))[0];
  const ajustesDe = (conteoId: string) =>
    c.filas<{ id: string }>("select id from movimiento_de_stock where conteo_id = $1", [conteoId]);

  // =============================================================================================
  describe("abrirConteo", () => {
    it("el gerente lo abre: queda ABIERTO con su autor y su hora, y auditado", async () => {
      const { dep } = await conExistencias(["1"]);
      const id = nuevoId();
      expect(await c.casos.abrirConteo(e.gerente, { id, depositoId: dep })).toEqual({
        ok: true,
        valor: { conteoId: id, yaExistia: false },
      });
      expect(await conteo(id)).toMatchObject({
        empresa_id: e.empresa,
        deposito_id: dep,
        estado: "ABIERTO",
        abierto_por: e.personaDelGerente,
        resuelto_por: null,
        motivo: null,
      });
      const auditados = (await c.auditoria(e.empresa, "CONTEO_ABIERTO")).filter(
        (r) => r["entidad_id"] === id,
      );
      expect(auditados).toHaveLength(1);
      expect(auditados[0]).toMatchObject({
        actor_persona_id: e.personaDelGerente,
        entidad: "conteo_fisico",
        despues: { depositoId: dep, estado: "ABIERTO" },
      });
    });

    it("el operador no lo abre (SIN_PERMISO); un administrador de una sola sucursal no abre uno de otra", async () => {
      const { dep } = await conExistencias(["1"]);
      const ajeno = await c.deposito(e, { sucursal: e.otraSucursal });
      expect(await c.casos.abrirConteo(e.operador, { id: nuevoId(), depositoId: dep })).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect(
        await c.casos.abrirConteo(e.administradorDeUnaSucursal, {
          id: nuevoId(),
          depositoId: ajeno,
        }),
      ).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      expect(
        (await c.casos.abrirConteo(e.administrador, { id: nuevoId(), depositoId: ajeno })).ok,
      ).toBe(true);
    });

    it("valida lo que llega: id y depósito mal formados, depósito que no existe o inactivo", async () => {
      const inactivo = await c.deposito(e, { activo: false });
      expect(await c.casos.abrirConteo(e.gerente, { id: "x", depositoId: inactivo })).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      expect(await c.casos.abrirConteo(e.gerente, { id: nuevoId(), depositoId: "x" })).toEqual({
        ok: false,
        error: "DEPOSITO_NO_ENCONTRADO",
      });
      expect(
        await c.casos.abrirConteo(e.gerente, { id: nuevoId(), depositoId: nuevoId() }),
      ).toEqual({ ok: false, error: "DEPOSITO_NO_ENCONTRADO" });
      expect(await c.casos.abrirConteo(e.gerente, { id: nuevoId(), depositoId: inactivo })).toEqual(
        { ok: false, error: "DEPOSITO_INACTIVO" },
      );
    });

    it("un solo conteo abierto por depósito (CONTEO_EN_CURSO); al aplicarlo o cancelarlo se puede abrir otro", async () => {
      const { dep, articulos } = await conExistencias(["3"]);
      const primero = await abrir(dep);
      expect(await c.casos.abrirConteo(e.gerente, { id: nuevoId(), depositoId: dep })).toEqual({
        ok: false,
        error: "CONTEO_EN_CURSO",
      });
      valorDe(await c.casos.cancelarConteo(e.gerente, { conteoId: primero, motivo: "Empezó mal" }));
      const segundo = await abrir(dep);
      valorDe(await contar(segundo, (articulos[0] as { producto: string }).producto, "3"));
      valorDe(await c.casos.aplicarConteo(e.gerente, { conteoId: segundo }));
      await abrir(dep);
    });

    it("I8: repetir abrirConteo con el mismo id devuelve yaExistia y deja un solo conteo; con otro depósito, ID_REUTILIZADO", async () => {
      const { dep } = await conExistencias(["1"]);
      const otro = await c.deposito(e);
      const id = nuevoId();
      expect(valorDe(await c.casos.abrirConteo(e.gerente, { id, depositoId: dep })).yaExistia).toBe(
        false,
      );
      expect(valorDe(await c.casos.abrirConteo(e.gerente, { id, depositoId: dep }))).toEqual({
        conteoId: id,
        yaExistia: true,
      });
      expect(
        await c.contar("select count(*) as n from conteo_fisico where deposito_id = $1", [dep]),
      ).toBe(1);
      expect(
        (await c.auditoria(e.empresa, "CONTEO_ABIERTO")).filter((r) => r["entidad_id"] === id),
      ).toHaveLength(1);
      expect(await c.casos.abrirConteo(e.gerente, { id, depositoId: otro })).toEqual({
        ok: false,
        error: "ID_REUTILIZADO",
      });
    });
  });

  // =============================================================================================
  describe("registrarConteo", () => {
    it("el operador cuenta en su sucursal; la base fija la existencia teórica de ese momento y la respuesta no la muestra (a ciegas)", async () => {
      const { dep, articulos } = await conExistencias(["10"]);
      const a = articulos[0] as { producto: string; articulo: string };
      const id = await abrir(dep);
      const registro = nuevoId();
      expect(
        await c.casos.registrarConteo(e.operador, {
          id: registro,
          conteoId: id,
          productoId: a.producto,
          cantidadContada: "7",
          unidadId: "UNIDAD",
        }),
      ).toEqual({ ok: true, valor: { yaExistia: false } });
      expect(
        (
          await c.filas(
            "select cantidad_contada::text as c, existencia_al_registrar::text as t, registrado_por from conteo_registro where id = $1",
            [registro],
          )
        )[0],
      ).toEqual({
        c: "7.0000",
        t: "10.0000",
        registrado_por: e.operador.personaId,
      });
      // Una venta después de contar no cambia lo que se vio al registrar.
      valorDe(
        await c.casos.registrarSalida(e.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "MERMA",
          renglones: [pedido(a.producto, "2")],
        }),
      );
      expect(
        (
          await c.filas(
            "select existencia_al_registrar::text as t from conteo_registro where id = $1",
            [registro],
          )
        )[0],
      ).toEqual({ t: "10.0000" });
    });

    it("el operador no cuenta en un depósito de otra sucursal; lo que no existe, no está controlado o está cerrado se rechaza", async () => {
      const { dep, articulos } = await conExistencias(["10"]);
      const a = articulos[0] as { producto: string };
      const ajeno = await c.deposito(e, { sucursal: e.otraSucursal });
      const delAjeno = await abrir(ajeno);
      const id = await abrir(dep);
      expect(await contar(delAjeno, a.producto, "1", e.operador)).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      expect(await contar(nuevoId(), a.producto, "1")).toEqual({
        ok: false,
        error: "CONTEO_NO_ENCONTRADO",
      });
      expect(await contar("x", a.producto, "1")).toEqual({
        ok: false,
        error: "CONTEO_NO_ENCONTRADO",
      });
      expect(await contar(id, nuevoId(), "1")).toEqual({
        ok: false,
        error: "ARTICULO_NO_CONTROLADO",
      });
      const inactivo = await c.articulo(e, { activo: false });
      expect(await contar(id, inactivo.producto, "1")).toEqual({
        ok: false,
        error: "ARTICULO_NO_CONTROLADO",
      });
      valorDe(await c.casos.cancelarConteo(e.gerente, { conteoId: id, motivo: "Se canceló" }));
      expect(await contar(id, a.producto, "1")).toEqual({ ok: false, error: "CONTEO_CERRADO" });
    });

    it("la cantidad contada es cero o más, con hasta 4 decimales y llevada EXACTA a la unidad de stock; cero es válido (no había nada)", async () => {
      const dep = await c.deposito(e);
      const gramos = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
      const toneladas = await c.articulo(e, { unidadBase: "TONELADA", dimension: "MASA" });
      const id = await abrir(dep);
      for (const cantidad of ["-1", "abc", "", "1e3", "1,5", "0.00001"]) {
        expect(await contar(id, gramos.producto, cantidad, e.gerente, "GRAMO"), cantidad).toEqual({
          ok: false,
          error: "CANTIDAD_INVALIDA",
        });
      }
      expect(await contar(id, gramos.producto, "1", e.gerente, "LITRO")).toEqual({
        ok: false,
        error: "DIMENSION_DISTINTA",
      });
      expect(await contar(id, toneladas.producto, "1", e.gerente, "GRAMO")).toEqual({
        ok: false,
        error: "CONVERSION_NO_EXACTA",
      });
      expect(await contar(id, gramos.producto, "1", e.gerente, "PARSEC")).toEqual({
        ok: false,
        error: "IDENTIFICADOR_INVALIDO",
      });
      valorDe(await contar(id, gramos.producto, "2", e.gerente, "KILOGRAMO"));
      valorDe(await contar(id, gramos.producto, "0", e.gerente, "GRAMO"));
      const guardados = await c.filas<{ c: string }>(
        "select cantidad_contada::text as c from conteo_registro where conteo_id = $1 order by orden",
        [id],
      );
      expect(guardados.map((g) => g.c)).toEqual(["2000.0000", "0.0000"]);
    });

    it("I9: repetir registrarConteo con el mismo id deja un solo registro y devuelve yaExistia; con otro contenido, ID_REUTILIZADO", async () => {
      const { dep, articulos } = await conExistencias(["10", "10"]);
      const [a, b] = articulos as unknown as [{ producto: string }, { producto: string }];
      const conteoId = await abrir(dep);
      const registro = {
        id: nuevoId(),
        conteoId,
        productoId: a.producto,
        cantidadContada: "7",
        unidadId: "UNIDAD",
      };
      expect(valorDe(await c.casos.registrarConteo(e.gerente, registro)).yaExistia).toBe(false);
      expect(valorDe(await c.casos.registrarConteo(e.gerente, registro))).toEqual({
        yaExistia: true,
      });
      expect(
        valorDe(await c.casos.registrarConteo(e.gerente, { ...registro, cantidadContada: "7.00" }))
          .yaExistia,
      ).toBe(true);
      expect(
        await c.contar("select count(*) as n from conteo_registro where conteo_id = $1", [
          conteoId,
        ]),
      ).toBe(1);
      expect(
        await c.casos.registrarConteo(e.gerente, { ...registro, cantidadContada: "8" }),
      ).toEqual({ ok: false, error: "ID_REUTILIZADO" });
      expect(
        await c.casos.registrarConteo(e.gerente, { ...registro, productoId: b.producto }),
      ).toEqual({ ok: false, error: "ID_REUTILIZADO" });
      expect(
        await c.contar("select count(*) as n from conteo_registro where conteo_id = $1", [
          conteoId,
        ]),
      ).toBe(1);
    });
  });

  // =============================================================================================
  describe("aplicarConteo", () => {
    it("deja un ajuste por conteo con un renglón por artículo CON diferencia: lo vendido después de contar queda intacto y lo no contado no cambia", async () => {
      const { dep, articulos } = await conExistencias(["10", "5", "0", "8"]);
      const [a, b, cc, d] = articulos as { producto: string; articulo: string }[] as [
        { producto: string; articulo: string },
        { producto: string; articulo: string },
        { producto: string; articulo: string },
        { producto: string; articulo: string },
      ];
      const id = await abrir(dep);
      valorDe(await contar(id, a.producto, "7")); // tenía 10: -3
      valorDe(await contar(id, b.producto, "5")); // tenía 5: sin diferencia
      valorDe(await contar(id, cc.producto, "4")); // no tenía saldo: +4
      // Se vende 2 de «a» después de contarlo: la diferencia sigue siendo 7 − 10.
      valorDe(
        await c.casos.registrarSalida(e.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "MERMA",
          renglones: [pedido(a.producto, "2")],
        }),
      );
      const r = valorDe(await c.casos.aplicarConteo(e.gerente, { conteoId: id }));
      expect(r.yaAplicado).toBe(false);
      expect(r.movimientoId).not.toBeNull();
      const m = (
        await c.filas("select * from movimiento_de_stock where id = $1", [r.movimientoId])
      )[0];
      expect(m).toMatchObject({
        clase: "AJUSTE_POR_CONTEO",
        motivo: "CONTEO",
        detalle: null,
        origen_tipo: "MANUAL",
        deposito_id: dep,
        conteo_id: id,
        accion: "conteos.aplicar",
        clave_idempotencia: `conteo_${id}`,
        registrado_por: e.personaDelGerente,
      });
      const renglones = await c.filas<{ articulo_id: string; cantidad: string }>(
        "select articulo_id, cantidad::text as cantidad from renglon_de_movimiento where movimiento_id = $1 order by cantidad",
        [r.movimientoId],
      );
      expect(renglones).toEqual([
        { articulo_id: a.articulo, cantidad: "-3.0000" },
        { articulo_id: cc.articulo, cantidad: "4.0000" },
      ]);
      expect(await c.existencia(dep, a.articulo)).toBe("5.0000"); // 10 − 2 vendidos − 3
      expect(await c.existencia(dep, b.articulo)).toBe("5.0000");
      expect(await c.existencia(dep, cc.articulo)).toBe("4.0000");
      expect(await c.existencia(dep, d.articulo)).toBe("8.0000"); // no se contó: no cambia
      expect(await conteo(id)).toMatchObject({
        estado: "APLICADO",
        resuelto_por: e.personaDelGerente,
        motivo: null,
      });
      const auditados = (await c.auditoria(e.empresa, "CONTEO_APLICADO")).filter(
        (x) => x["entidad_id"] === id,
      );
      expect(auditados).toHaveLength(1);
      expect(auditados[0]).toMatchObject({
        antes: { estado: "ABIERTO" },
        despues: { estado: "APLICADO", movimientoId: r.movimientoId, renglonesConDiferencia: 2 },
      });
      expect(valorDe(await c.consultas.verificarSaldos(e.gerente))).toEqual([]);
    });

    it("de varios registros del mismo artículo vale el último (recontar)", async () => {
      const { dep, articulos } = await conExistencias(["10"]);
      const a = articulos[0] as { producto: string; articulo: string };
      const id = await abrir(dep);
      valorDe(await contar(id, a.producto, "3"));
      valorDe(await contar(id, a.producto, "9"));
      valorDe(await c.casos.aplicarConteo(e.gerente, { conteoId: id }));
      expect(await c.existencia(dep, a.articulo)).toBe("9.0000");
    });

    it("es un ajuste: nunca se bloquea por existencia negativa (un conteo que encuentra menos tiene que poder aplicarse), ni por BLOQUEAR", async () => {
      const emp = await c.escenario();
      await c.fijarNivel(emp.empresa, "BLOQUEAR");
      const dep = await c.deposito(emp);
      const a = await c.articulo(emp);
      valorDe(
        await c.casos.registrarEntrada(emp.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [pedido(a.producto, "2")],
        }),
      );
      const id = valorDe(
        await c.casos.abrirConteo(emp.gerente, { id: nuevoId(), depositoId: dep }),
      ).conteoId;
      valorDe(
        await c.casos.registrarConteo(emp.gerente, {
          id: nuevoId(),
          conteoId: id,
          productoId: a.producto,
          cantidadContada: "0",
          unidadId: "UNIDAD",
        }),
      );
      // Mientras tanto se vendió todo lo que había (con BLOQUEAR no se podría vender más): la diferencia 0 − 2 deja el saldo en −2.
      valorDe(
        await c.casos.registrarSalida(emp.gerente, {
          clave: nuevoId(),
          depositoId: dep,
          motivo: "MERMA",
          renglones: [pedido(a.producto, "2")],
        }),
      );
      valorDe(await c.casos.aplicarConteo(emp.gerente, { conteoId: id }));
      expect(await c.existencia(dep, a.articulo)).toBe("-2.0000");
    });

    it("no se aplica vacío (CONTEO_SIN_REGISTROS) y el conteo sigue abierto; sin diferencias se resuelve sin escribir un ajuste (movimientoId null)", async () => {
      const { dep, articulos } = await conExistencias(["5"]);
      const a = articulos[0] as { producto: string; articulo: string };
      const vacio = await abrir(dep);
      expect(await c.casos.aplicarConteo(e.gerente, { conteoId: vacio })).toEqual({
        ok: false,
        error: "CONTEO_SIN_REGISTROS",
      });
      expect(await conteo(vacio)).toMatchObject({ estado: "ABIERTO" });
      valorDe(await c.casos.cancelarConteo(e.gerente, { conteoId: vacio, motivo: "Vacío" }));
      const igual = await abrir(dep);
      valorDe(await contar(igual, a.producto, "5"));
      const antes = await c.contar(
        "select count(*) as n from movimiento_de_stock where empresa_id = $1",
        [e.empresa],
      );
      expect(await c.casos.aplicarConteo(e.gerente, { conteoId: igual })).toEqual({
        ok: true,
        valor: { movimientoId: null, yaAplicado: false },
      });
      expect(await conteo(igual)).toMatchObject({ estado: "APLICADO" });
      expect(
        await c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [
          e.empresa,
        ]),
      ).toBe(antes);
      // Repetirlo: ya estaba aplicado, y sigue sin ajuste.
      expect(await c.casos.aplicarConteo(e.gerente, { conteoId: igual })).toEqual({
        ok: true,
        valor: { movimientoId: null, yaAplicado: true },
      });
    });

    it("el operador no aplica (SIN_PERMISO); un conteo que no existe, de otra sucursal o cancelado se rechaza; un conteo cancelado no se aplica", async () => {
      const { dep, articulos } = await conExistencias(["5"]);
      const a = articulos[0] as { producto: string };
      const id = await abrir(dep);
      valorDe(await contar(id, a.producto, "1", e.operador));
      expect(await c.casos.aplicarConteo(e.operador, { conteoId: id })).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect(await conteo(id)).toMatchObject({ estado: "ABIERTO" });
      expect(await c.casos.aplicarConteo(e.gerente, { conteoId: nuevoId() })).toEqual({
        ok: false,
        error: "CONTEO_NO_ENCONTRADO",
      });
      expect(await c.casos.aplicarConteo(e.gerente, { conteoId: "x" })).toEqual({
        ok: false,
        error: "CONTEO_NO_ENCONTRADO",
      });
      const ajeno = await c.deposito(e, { sucursal: e.otraSucursal });
      const delAjeno = await abrir(ajeno);
      expect(
        await c.casos.aplicarConteo(e.administradorDeUnaSucursal, { conteoId: delAjeno }),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
      valorDe(await c.casos.cancelarConteo(e.gerente, { conteoId: id, motivo: "No sirve" }));
      expect(await c.casos.aplicarConteo(e.gerente, { conteoId: id })).toEqual({
        ok: false,
        error: "CONTEO_CANCELADO",
      });
      expect(await ajustesDe(id)).toEqual([]);
    });

    it("P12: aplicar el mismo conteo dos veces deja un solo ajuste y devuelve yaAplicado con el mismo movimiento", async () => {
      const { dep, articulos } = await conExistencias(["10"]);
      const a = articulos[0] as { producto: string; articulo: string };
      const id = await abrir(dep);
      valorDe(await contar(id, a.producto, "6"));
      const primera = valorDe(await c.casos.aplicarConteo(e.gerente, { conteoId: id }));
      const auditoriasAntes = (await c.auditoria(e.empresa, "CONTEO_APLICADO")).length;
      const segunda = valorDe(await c.casos.aplicarConteo(e.gerente, { conteoId: id }));
      expect(primera.yaAplicado).toBe(false);
      expect(segunda).toEqual({ movimientoId: primera.movimientoId, yaAplicado: true });
      expect(await ajustesDe(id)).toHaveLength(1);
      expect(await c.existencia(dep, a.articulo)).toBe("6.0000");
      expect((await c.auditoria(e.empresa, "CONTEO_APLICADO")).length).toBe(auditoriasAntes);
      // El ajuste de un conteo no se anula (se corrige con otro conteo o un ajuste).
      expect(
        await c.casos.anularMovimiento(e.gerente, {
          clave: nuevoId(),
          movimientoId: primera.movimientoId as string,
          detalle: "Error",
        }),
      ).toEqual({ ok: false, error: "MOVIMIENTO_NO_ANULABLE" });
    });

    it("la clave derivada del conteo no la puede ocupar nadie desde afuera: lo que manda la pantalla tiene que ser un UUID", async () => {
      const { dep, articulos } = await conExistencias(["10"]);
      const a = articulos[0] as { producto: string };
      const id = await abrir(dep);
      expect(
        await c.casos.registrarEntrada(e.gerente, {
          clave: `conteo_${id}`,
          depositoId: dep,
          motivo: "COMPRA",
          renglones: [pedido(a.producto, "1")],
        }),
      ).toEqual({ ok: false, error: "IDENTIFICADOR_INVALIDO" });
      valorDe(await contar(id, a.producto, "4"));
      valorDe(await c.casos.aplicarConteo(e.gerente, { conteoId: id }));
    });
  });

  // =============================================================================================
  describe("cancelarConteo", () => {
    it("el motivo es obligatorio; al cancelar queda resuelto con su motivo y autor, auditado, y no cambia nada del libro", async () => {
      const { dep, articulos } = await conExistencias(["10"]);
      const a = articulos[0] as { producto: string; articulo: string };
      const id = await abrir(dep);
      valorDe(await contar(id, a.producto, "1"));
      for (const motivo of ["", "   ", "Con\nsalto", "<b>x</b>", "x".repeat(301)]) {
        expect(
          await c.casos.cancelarConteo(e.gerente, { conteoId: id, motivo }),
          JSON.stringify(motivo),
        ).toEqual({ ok: false, error: "MOTIVO_REQUERIDO" });
      }
      expect(
        await c.casos.cancelarConteo(e.gerente, { conteoId: id, motivo: undefined as never }),
      ).toEqual({ ok: false, error: "MOTIVO_REQUERIDO" });
      expect(await conteo(id)).toMatchObject({ estado: "ABIERTO" });
      expect(
        await c.casos.cancelarConteo(e.gerente, {
          conteoId: id,
          motivo: "Se contó en el depósito equivocado",
        }),
      ).toEqual({
        ok: true,
        valor: { yaEstaba: false },
      });
      expect(await conteo(id)).toMatchObject({
        estado: "CANCELADO",
        motivo: "Se contó en el depósito equivocado",
        resuelto_por: e.personaDelGerente,
      });
      expect(await c.existencia(dep, a.articulo)).toBe("10.0000");
      expect(await ajustesDe(id)).toEqual([]);
      const auditados = (await c.auditoria(e.empresa, "CONTEO_CANCELADO")).filter(
        (x) => x["entidad_id"] === id,
      );
      expect(auditados).toHaveLength(1);
      expect(auditados[0]).toMatchObject({
        despues: { estado: "CANCELADO", motivo: "Se contó en el depósito equivocado" },
      });
    });

    it("I10: cancelar dos veces es ok y no audita la segunda; un conteo aplicado no se cancela (CONTEO_CERRADO)", async () => {
      const { dep, articulos } = await conExistencias(["10"]);
      const a = articulos[0] as { producto: string };
      const id = await abrir(dep);
      valorDe(await c.casos.cancelarConteo(e.gerente, { conteoId: id, motivo: "Prueba" }));
      const antes = (await c.auditoria(e.empresa, "CONTEO_CANCELADO")).length;
      expect(await c.casos.cancelarConteo(e.gerente, { conteoId: id, motivo: "Prueba" })).toEqual({
        ok: true,
        valor: { yaEstaba: true },
      });
      expect((await c.auditoria(e.empresa, "CONTEO_CANCELADO")).length).toBe(antes);
      const aplicado = await abrir(dep);
      valorDe(await contar(aplicado, a.producto, "3"));
      valorDe(await c.casos.aplicarConteo(e.gerente, { conteoId: aplicado }));
      expect(
        await c.casos.cancelarConteo(e.gerente, { conteoId: aplicado, motivo: "Tarde" }),
      ).toEqual({ ok: false, error: "CONTEO_CERRADO" });
    });

    it("el operador no cancela (SIN_PERMISO); un conteo que no existe o fuera del alcance se rechaza", async () => {
      const { dep } = await conExistencias(["1"]);
      const id = await abrir(dep);
      expect(
        await c.casos.cancelarConteo(e.operador, { conteoId: id, motivo: "No puedo" }),
      ).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(
        await c.casos.cancelarConteo(e.gerente, { conteoId: nuevoId(), motivo: "No existe" }),
      ).toEqual({ ok: false, error: "CONTEO_NO_ENCONTRADO" });
      const ajeno = await abrir(await c.deposito(e, { sucursal: e.otraSucursal }));
      expect(
        await c.casos.cancelarConteo(e.administradorDeUnaSucursal, {
          conteoId: ajeno,
          motivo: "No es mío",
        }),
      ).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      expect(await conteo(id)).toMatchObject({ estado: "ABIERTO" });
    });
  });

  // =============================================================================================
  describe("consultas del conteo (a ciegas)", () => {
    it("el operador ve lo contado pero NO la existencia teórica ni la diferencia; el administrador y el gerente sí", async () => {
      const { dep, articulos } = await conExistencias(["10", "4"]);
      const [a, b] = articulos as [
        { producto: string; articulo: string },
        { producto: string; articulo: string },
      ];
      const id = await abrir(dep);
      valorDe(await contar(id, a.producto, "3", e.operador));
      valorDe(await contar(id, a.producto, "7", e.operador)); // recuento: vale este
      valorDe(await contar(id, b.producto, "4", e.operador));
      const delOperador = valorDe(await c.consultas.fichaDeConteo(e.operador, { conteoId: id }));
      expect(delOperador?.conteo).toMatchObject({ id, depositoId: dep, estado: "ABIERTO" });
      expect(delOperador?.registros).toHaveLength(3);
      for (const r of delOperador?.registros ?? []) {
        expect(r).not.toHaveProperty("existenciaTeorica");
        expect(r).not.toHaveProperty("diferencia");
        expect(r.registradoPor).toBe(e.operador.personaId);
      }
      expect(
        delOperador?.registros.map((r) => [r.productoId, r.cantidadContada, r.vigente]),
      ).toEqual([
        [a.producto, "3.0000", false],
        [a.producto, "7.0000", true],
        [b.producto, "4.0000", true],
      ]);
      for (const quien of [e.gerente, e.administrador]) {
        const ficha = valorDe(await c.consultas.fichaDeConteo(quien, { conteoId: id }));
        expect(
          ficha?.registros.map((r) => [r.cantidadContada, r.existenciaTeorica, r.diferencia]),
        ).toEqual([
          ["3.0000", "10.0000", "-7.0000"],
          ["7.0000", "10.0000", "-3.0000"],
          ["4.0000", "4.0000", "0.0000"],
        ]);
      }
    });

    it("el operador no ve un conteo de otra sucursal (null, como si no existiera) y los mal formados dan null", async () => {
      const ajeno = await abrir(await c.deposito(e, { sucursal: e.otraSucursal }));
      expect(valorDe(await c.consultas.fichaDeConteo(e.operador, { conteoId: ajeno }))).toBeNull();
      expect(
        valorDe(await c.consultas.fichaDeConteo(e.gerente, { conteoId: ajeno })),
      ).not.toBeNull();
      expect(
        valorDe(await c.consultas.fichaDeConteo(e.gerente, { conteoId: nuevoId() })),
      ).toBeNull();
      expect(valorDe(await c.consultas.fichaDeConteo(e.gerente, { conteoId: "x" }))).toBeNull();
    });

    it("listarConteos filtra por depósito y estado, solo muestra lo del alcance y los filtros mal formados dan una lista vacía", async () => {
      const emp = await c.escenario();
      const central = await c.deposito(emp);
      const norte = await c.deposito(emp, { sucursal: emp.otraSucursal });
      const abierto = valorDe(
        await c.casos.abrirConteo(emp.gerente, { id: nuevoId(), depositoId: central }),
      ).conteoId;
      const cancelado = valorDe(
        await c.casos.abrirConteo(emp.gerente, { id: nuevoId(), depositoId: norte }),
      ).conteoId;
      valorDe(await c.casos.cancelarConteo(emp.gerente, { conteoId: cancelado, motivo: "Prueba" }));
      const todos = valorDe(await c.consultas.listarConteos(emp.gerente));
      expect(todos.map((x) => x.id).sort()).toEqual([abierto, cancelado].sort());
      expect(
        valorDe(await c.consultas.listarConteos(emp.gerente, { estado: "ABIERTO" })).map(
          (x) => x.id,
        ),
      ).toEqual([abierto]);
      expect(
        valorDe(
          await c.consultas.listarConteos(emp.gerente, { estado: "CANCELADO", depositoId: norte }),
        ).map((x) => [x.id, x.motivo]),
      ).toEqual([[cancelado, "Prueba"]]);
      expect(valorDe(await c.consultas.listarConteos(emp.operador)).map((x) => x.id)).toEqual([
        abierto,
      ]);
      expect(valorDe(await c.consultas.listarConteos(emp.operador, { depositoId: norte }))).toEqual(
        [],
      );
      expect(valorDe(await c.consultas.listarConteos(emp.gerente, { estado: "ROTO" }))).toEqual([]);
      expect(valorDe(await c.consultas.listarConteos(emp.gerente, { depositoId: "x" }))).toEqual(
        [],
      );
    });
  });

  // =============================================================================================
  describe("aislamiento entre empresas (P15, conteos)", () => {
    it("la empresa B no ve, cuenta, aplica ni cancela un conteo de A, y reusar su id es indistinguible de reusar uno propio", async () => {
      const a = await c.escenario();
      const b = await c.escenario();
      const depA = await c.deposito(a);
      const artA = await c.articulo(a);
      valorDe(
        await c.casos.registrarEntrada(a.gerente, {
          clave: nuevoId(),
          depositoId: depA,
          motivo: "COMPRA",
          renglones: [pedido(artA.producto, "5")],
        }),
      );
      const depB = await c.deposito(b);
      const artB = await c.articulo(b);
      const idA = valorDe(
        await c.casos.abrirConteo(a.gerente, { id: nuevoId(), depositoId: depA }),
      ).conteoId;
      valorDe(
        await c.casos.registrarConteo(a.gerente, {
          id: nuevoId(),
          conteoId: idA,
          productoId: artA.producto,
          cantidadContada: "1",
          unidadId: "UNIDAD",
        }),
      );
      expect(await c.casos.abrirConteo(b.gerente, { id: nuevoId(), depositoId: depA })).toEqual({
        ok: false,
        error: "DEPOSITO_NO_ENCONTRADO",
      });
      expect(
        await c.casos.registrarConteo(b.gerente, {
          id: nuevoId(),
          conteoId: idA,
          productoId: artB.producto,
          cantidadContada: "1",
          unidadId: "UNIDAD",
        }),
      ).toEqual({
        ok: false,
        error: "CONTEO_NO_ENCONTRADO",
      });
      expect(await c.casos.aplicarConteo(b.gerente, { conteoId: idA })).toEqual({
        ok: false,
        error: "CONTEO_NO_ENCONTRADO",
      });
      expect(await c.casos.cancelarConteo(b.gerente, { conteoId: idA, motivo: "Ajeno" })).toEqual({
        ok: false,
        error: "CONTEO_NO_ENCONTRADO",
      });
      expect(valorDe(await c.consultas.fichaDeConteo(b.gerente, { conteoId: idA }))).toBeNull();
      expect(valorDe(await c.consultas.listarConteos(b.gerente))).toEqual([]);
      // El id de un conteo de A en una apertura de B: no se distingue de un id ya usado por otro depósito propio.
      expect(await c.casos.abrirConteo(b.gerente, { id: idA, depositoId: depB })).toEqual({
        ok: false,
        error: "ID_REUTILIZADO",
      });
      expect(await conteo(idA)).toMatchObject({ empresa_id: a.empresa, estado: "ABIERTO" });
    });
  });
});
