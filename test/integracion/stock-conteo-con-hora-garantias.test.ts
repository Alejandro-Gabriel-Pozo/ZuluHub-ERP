import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  abrirConteoDe,
  conStock,
  conteoDiferencia,
  contarEn,
  hace,
  movimientoEn,
} from "./stock-conteo-hora-apoyo";
import {
  montarStock,
  nuevoId,
  valorDe,
  type EscenarioDeStock,
  type MontajeDeStock,
} from "./stock-casos-apoyo";

/**
 * E5, conteo con hora: lo que se garantiza aunque algo falle, se repita o lo pida quien no debe (spec §4 y §5: CI1 a CI4 idempotencia, CA1 y CA2
 * atomicidad, CS1 aislamiento por empresa, CP1 a CP3 permisos, CC3 la revisión que cambió, y el motivo «vencimiento» que pide `stock.ajustar`).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("stock: conteo con hora (garantías)", () => {
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

  const cuenta = (tabla: string, conteoId: string) =>
    c.contar(`select count(*) as n from ${tabla} where conteo_id = $1`, [conteoId]);
  const estadoDe = async (conteoId: string) =>
    (
      await c.filas<{ estado: string }>("select estado from conteo_fisico where id = $1", [
        conteoId,
      ])
    )[0]?.estado;
  /** Un conteo con 20 en el depósito y 18 contados a las 10:00: −2 de diferencia, listo para aplicar. */
  const faltanDos = async (stock = "20") => {
    const s = await conStock(c, e, stock);
    const id = await abrirConteoDe(c, e, s.dep);
    valorDe(await contarEn(c, e.gerente, id, s.producto, "18", { contadoEn: hace(-10) }));
    return { ...s, id };
  };

  describe("idempotencia (CI1 a CI4)", () => {
    it("CI1: cargar dos veces lo mismo (clic doble) deja UNA carga; con otra hora es otro contenido; sin hora en el reintento es el mismo", async () => {
      const s = await conStock(c, e, "20");
      const id = await abrirConteoDe(c, e, s.dep);
      const registro = nuevoId();
      const con = (extra: { contadoEn?: Date }) =>
        contarEn(c, e.gerente, id, s.producto, "18", { id: registro, ...extra });
      expect(await con({ contadoEn: hace(-10) })).toEqual({
        ok: true,
        valor: { yaExistia: false },
      });
      expect(await con({ contadoEn: hace(-10) })).toEqual({ ok: true, valor: { yaExistia: true } });
      expect(await con({ contadoEn: hace(-9) })).toEqual({ ok: false, error: "ID_REUTILIZADO" });
      // Un reintento que ya no manda la hora (el servidor usaría otro reloj): no se compara.
      expect(await con({})).toEqual({ ok: true, valor: { yaExistia: true } });
      expect(await cuenta("conteo_registro", id)).toBe(1);
      // Al revés: lo primero cargado SIN hora y el reintento CON una hora declarada es otro contenido.
      const otro = nuevoId();
      valorDe(await contarEn(c, e.gerente, id, s.producto, "19", { id: otro }));
      expect(
        await contarEn(c, e.gerente, id, s.producto, "19", { id: otro, contadoEn: hace(-10) }),
      ).toEqual({
        ok: false,
        error: "ID_REUTILIZADO",
      });
      // Con otra cantidad, también.
      expect(await contarEn(c, e.gerente, id, s.producto, "7", { id: otro })).toEqual({
        ok: false,
        error: "ID_REUTILIZADO",
      });
    });

    it("CI1 (un reintento tardío): ya cargado, repetirlo después de aplicado el conteo devuelve lo hecho; no se mira la ventana de nuevo", async () => {
      const s = await conStock(c, e, "20");
      const id = await abrirConteoDe(c, e, s.dep);
      const registro = nuevoId();
      valorDe(
        await contarEn(c, e.gerente, id, s.producto, "20", { id: registro, contadoEn: hace(-10) }),
      );
      valorDe(await c.aplicarConteo(e.gerente, id));
      expect(
        await contarEn(c, e.gerente, id, s.producto, "20", { id: registro, contadoEn: hace(-10) }),
      ).toEqual({
        ok: true,
        valor: { yaExistia: true },
      });
    });

    it("CI2: aplicar dos veces el mismo conteo con las mismas respuestas: un ajuste, una explicación por artículo, y la segunda no escribe ni audita", async () => {
      const t = await faltanDos();
      const respuestas = [{ productoId: t.producto, motivo: "ROTURA" }];
      const primera = valorDe(await c.aplicarConteo(e.gerente, t.id, respuestas));
      const auditoriasAntes = (await c.auditoria(e.empresa, "CONTEO_APLICADO")).length;
      const segunda = valorDe(await c.aplicarConteo(e.gerente, t.id, respuestas));
      expect(primera.yaAplicado).toBe(false);
      expect(segunda).toEqual({ movimientoId: primera.movimientoId, yaAplicado: true });
      expect(await cuenta("movimiento_de_stock", t.id)).toBe(1);
      expect(await cuenta("conteo_diferencia", t.id)).toBe(1);
      expect((await c.auditoria(e.empresa, "CONTEO_APLICADO")).length).toBe(auditoriasAntes);
      expect(await c.existencia(t.dep, t.articulo)).toBe("18.0000");
    });

    it("CI3: aplicar de nuevo con OTRAS respuestas devuelve lo que quedó guardado la primera vez: el primer hecho manda", async () => {
      const t = await faltanDos();
      const primera = valorDe(
        await c.aplicarConteo(e.gerente, t.id, [{ productoId: t.producto, motivo: "ROTURA" }]),
      );
      const segunda = valorDe(
        await c.aplicarConteo(e.gerente, t.id, [{ productoId: t.producto, motivo: "MERMA" }]),
      );
      expect(segunda).toEqual({ movimientoId: primera.movimientoId, yaAplicado: true });
      expect(await conteoDiferencia(c, t.id)).toEqual([
        expect.objectContaining({ motivo: "ROTURA" }),
      ]);
      expect(await c.existencia(t.dep, t.articulo)).toBe("18.0000");
    });

    it("CI4: aplicar y cancelar el mismo conteo: el que llega segundo ve que ya está resuelto (en cualquier orden)", async () => {
      const aplicado = await faltanDos();
      valorDe(
        await c.aplicarConteo(e.gerente, aplicado.id, [
          { productoId: aplicado.producto, motivo: "MERMA" },
        ]),
      );
      expect(
        await c.casos.cancelarConteo(e.gerente, { conteoId: aplicado.id, motivo: "Tarde" }),
      ).toEqual({
        ok: false,
        error: "CONTEO_CERRADO",
      });
      const cancelado = await faltanDos();
      valorDe(
        await c.casos.cancelarConteo(e.gerente, { conteoId: cancelado.id, motivo: "Se cancela" }),
      );
      expect(
        await c.aplicarConteo(e.gerente, cancelado.id, [
          { productoId: cancelado.producto, motivo: "MERMA" },
        ]),
      ).toEqual({
        ok: false,
        error: "CONTEO_CANCELADO",
      });
    });
  });

  describe("atomicidad (CA1 y CA2): todo o nada", () => {
    /** Una falla inyectada: un disparador que rechaza el alta en esa tabla, puesto y sacado dentro de la prueba. */
    const conFalla = async (tabla: string, trabajo: () => Promise<void>) => {
      await c.dueno.query(
        `create function falla_inyectada() returns trigger language plpgsql as $$ begin raise exception 'falla inyectada'; end $$`,
      );
      await c.dueno.query(
        `create trigger falla_inyectada before insert on ${tabla} for each row execute function falla_inyectada()`,
      );
      try {
        await trabajo();
      } finally {
        await c.dueno.query(`drop trigger falla_inyectada on ${tabla}`);
        await c.dueno.query("drop function falla_inyectada()");
      }
    };
    const nadaCambio = async (t: { id: string; dep: string; articulo: string }) => {
      expect(await estadoDe(t.id)).toBe("ABIERTO");
      expect(await cuenta("movimiento_de_stock", t.id)).toBe(0);
      expect(await cuenta("conteo_diferencia", t.id)).toBe(0);
      expect(await cuenta("conteo_marca", t.id)).toBe(0);
      expect(await c.existencia(t.dep, t.articulo)).toBe("20.0000");
      expect(
        (await c.auditoria(e.empresa, "CONTEO_APLICADO")).filter((r) => r["entidad_id"] === t.id),
      ).toHaveLength(0);
    };

    it("CA1: si falla al escribir las explicaciones (después de insertar el ajuste), no queda nada: conteo abierto, sin ajuste y el saldo igual", async () => {
      const t = await faltanDos();
      await conFalla("conteo_diferencia", async () => {
        const r = await c
          .aplicarConteo(e.gerente, t.id, [{ productoId: t.producto, motivo: "ROTURA" }])
          .catch((error: unknown) => ({ ok: false as const, error }));
        expect(r.ok).toBe(false);
      });
      await nadaCambio(t);
      // Sin la falla, el mismo conteo se aplica normalmente.
      expect(
        valorDe(
          await c.aplicarConteo(e.gerente, t.id, [{ productoId: t.producto, motivo: "ROTURA" }]),
        ).yaAplicado,
      ).toBe(false);
    });

    it("CA2: si falla al escribir las marcas, tampoco queda nada", async () => {
      const s = await conStock(c, e, "20");
      const id = await abrirConteoDe(c, e, s.dep);
      const venta = await movimientoEn(c, e, {
        dep: s.dep,
        articulo: s.articulo,
        cantidad: "-3",
        hechoEn: hace(-30),
      });
      valorDe(await contarEn(c, e.gerente, id, s.producto, "17", { contadoEn: hace(-60) }));
      await conFalla("conteo_marca", async () => {
        const r = await c
          .aplicarConteo(e.gerente, id, [
            { productoId: s.producto, marcas: [{ movimientoId: venta, numero: 1 }] },
          ])
          .catch((error: unknown) => ({ ok: false as const, error }));
        expect(r.ok).toBe(false);
      });
      expect(await estadoDe(id)).toBe("ABIERTO");
      expect(await cuenta("conteo_diferencia", id)).toBe(0);
      expect(await cuenta("conteo_marca", id)).toBe(0);
      expect(await c.existencia(s.dep, s.articulo)).toBe("17.0000");
    });
  });

  describe("la revisión que cambió (CC3, CF-D10): nunca se aplica lo que la persona no vio", () => {
    it("un movimiento con hora ANTERIOR a la del conteo que entra mientras se revisa cambia lo que el sistema creía: REVISION_DESACTUALIZADA, no se escribe nada y al recargar se ve el dato nuevo", async () => {
      const t = await faltanDos();
      const huellaVista = await c.huellaDeConteo(e.gerente, t.id);
      // Entra una compra recibida antes de contar (hora anterior a la del conteo) y se carga recién ahora.
      await movimientoEn(c, e, {
        dep: t.dep,
        articulo: t.articulo,
        cantidad: "2",
        hechoEn: hace(-20),
      });
      expect(
        await c.casos.aplicarConteo(e.gerente, {
          conteoId: t.id,
          huella: huellaVista,
          respuestas: [{ productoId: t.producto, motivo: "ROTURA" }],
        }),
      ).toEqual({ ok: false, error: "REVISION_DESACTUALIZADA" });
      expect(await estadoDe(t.id)).toBe("ABIERTO");
      expect(await cuenta("movimiento_de_stock", t.id)).toBe(0);
      // Recargar: ahora E = 22 y la diferencia es −4; con esa revisión sí se aplica.
      const ficha = valorDe(await c.consultas.fichaDeConteo(e.gerente, { conteoId: t.id }));
      expect(ficha?.registros[0]).toMatchObject({
        existenciaALaHora: "22.0000",
        diferenciaBruta: "-4.0000",
      });
      valorDe(
        await c.aplicarConteo(e.gerente, t.id, [{ productoId: t.producto, motivo: "ROTURA" }]),
      );
      expect(await c.existencia(t.dep, t.articulo)).toBe("18.0000");
    });

    it("una venta POSTERIOR a la hora del conteo que entra mientras se revisa no cambia lo que se vio: el conteo se aplica igual", async () => {
      const t = await faltanDos();
      const huellaVista = await c.huellaDeConteo(e.gerente, t.id);
      await movimientoEn(c, e, {
        dep: t.dep,
        articulo: t.articulo,
        cantidad: "-1",
        hechoEn: hace(-5),
      });
      const r = valorDe(
        await c.casos.aplicarConteo(e.gerente, {
          conteoId: t.id,
          huella: huellaVista,
          respuestas: [{ productoId: t.producto, motivo: "ROTURA" }],
        }),
      );
      expect(r.movimientoId).not.toBeNull();
      // 20 − 1 vendida − 2 de diferencia.
      expect(await c.existencia(t.dep, t.articulo)).toBe("17.0000");
    });

    it("recontar mientras se revisa también la cambia, y una huella ajena, vacía o mal formada no aplica nada", async () => {
      const t = await faltanDos();
      const huellaVista = await c.huellaDeConteo(e.gerente, t.id);
      valorDe(await contarEn(c, e.gerente, t.id, t.producto, "19", { contadoEn: hace(-10) }));
      const pedido = { conteoId: t.id, respuestas: [{ productoId: t.producto, motivo: "ROTURA" }] };
      for (const huella of [huellaVista, "", "x", "0".repeat(64)]) {
        expect(await c.casos.aplicarConteo(e.gerente, { ...pedido, huella })).toEqual({
          ok: false,
          error: "REVISION_DESACTUALIZADA",
        });
      }
      expect(await estadoDe(t.id)).toBe("ABIERTO");
    });
  });

  describe("permisos y alcance (CP1 a CP3)", () => {
    it("CP1: el operador carga con hora pero NO ve lo que el sistema creía, ni la revisión, ni la huella, ni los candidatos, y no aplica (SIN_PERMISO)", async () => {
      const s = await conStock(c, e, "20");
      const id = await abrirConteoDe(c, e, s.dep);
      expect(await contarEn(c, e.operador, id, s.producto, "18", { contadoEn: hace(-10) })).toEqual(
        { ok: true, valor: { yaExistia: false } },
      );
      const ficha = valorDe(await c.consultas.fichaDeConteo(e.operador, { conteoId: id }));
      expect(ficha?.registros[0]?.contadoEn.getTime()).toBe(hace(-10).getTime());
      for (const campo of ["existenciaALaHora", "movidoDesdeLaHora", "diferenciaBruta"]) {
        expect(ficha?.registros[0]).not.toHaveProperty(campo);
      }
      expect(ficha).not.toHaveProperty("huella");
      expect(ficha).not.toHaveProperty("explicaciones");
      expect(
        await c.consultas.candidatosDeConteo(e.operador, { conteoId: id, productoId: s.producto }),
      ).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect(
        await c.aplicarConteo(e.operador, id, [{ productoId: s.producto, motivo: "MERMA" }]),
      ).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect(await estadoDe(id)).toBe("ABIERTO");
    });

    it("CP1 (un conteo aplicado): la explicación guardada la ve quien puede aplicar y no el operador", async () => {
      const t = await faltanDos();
      valorDe(
        await c.aplicarConteo(e.gerente, t.id, [{ productoId: t.producto, motivo: "ROTURA" }]),
      );
      const delGerente = valorDe(await c.consultas.fichaDeConteo(e.gerente, { conteoId: t.id }));
      expect(delGerente?.explicaciones).toEqual([
        expect.objectContaining({
          productoId: t.producto,
          diferenciaFinal: "-2.0000",
          motivo: "ROTURA",
          explicadaPor: e.personaDelGerente,
        }),
      ]);
      expect(delGerente).not.toHaveProperty("huella");
      const delOperador = valorDe(await c.consultas.fichaDeConteo(e.operador, { conteoId: t.id }));
      expect(delOperador).not.toHaveProperty("explicaciones");
    });

    it("CP2: quien tiene alcance solo sobre otra sucursal no carga, ni aplica, ni ve la ficha ni los candidatos", async () => {
      const ajeno = await c.deposito(e, { sucursal: e.otraSucursal });
      const a = await c.articulo(e);
      const id = await abrirConteoDe(c, e, ajeno);
      const q = e.administradorDeUnaSucursal;
      expect(await contarEn(c, q, id, a.producto, "1")).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      expect(await c.aplicarConteo(q, id)).toEqual({
        ok: false,
        error: "SUCURSAL_FUERA_DE_ALCANCE",
      });
      expect(valorDe(await c.consultas.fichaDeConteo(q, { conteoId: id }))).toBeNull();
      expect(
        valorDe(await c.consultas.candidatosDeConteo(q, { conteoId: id, productoId: a.producto })),
      ).toBeNull();
    });

    it("CP3: el motivo «vencimiento» pide además poder ajustar stock (S-7): sin `stock.ajustar`, quien aplica el conteo no puede darlo", async () => {
      if (base === null) return;
      const sinAjustar = await montarStock(base, {
        reglas: { ...c.reglas, permisos: { ...PERMISOS_DE_EMPRESA, "stock.ajustar": [] } },
      });
      try {
        const m = await sinAjustar.escenario();
        const dep = await sinAjustar.deposito(m);
        const a = await sinAjustar.articulo(m);
        await movimientoEn(sinAjustar, m, {
          dep,
          articulo: a.articulo,
          cantidad: "20",
          hechoEn: hace(-120),
        });
        const id = valorDe(
          await sinAjustar.casos.abrirConteo(m.gerente, { id: nuevoId(), depositoId: dep }),
        ).conteoId;
        valorDe(
          await contarEn(sinAjustar, m.gerente, id, a.producto, "18", { contadoEn: hace(-10) }),
        );
        expect(
          await sinAjustar.aplicarConteo(m.gerente, id, [
            { productoId: a.producto, motivo: "VENCIMIENTO" },
          ]),
        ).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
        expect(await sinAjustar.existencia(dep, a.articulo)).toBe("20.0000");
        // Con otro motivo, el mismo conteo se aplica.
        valorDe(
          await sinAjustar.aplicarConteo(m.gerente, id, [
            { productoId: a.producto, motivo: "MERMA" },
          ]),
        );
        expect(await sinAjustar.existencia(dep, a.articulo)).toBe("18.0000");
      } finally {
        await sinAjustar.cerrar();
      }
    });
  });

  describe("aislamiento entre empresas (CS1)", () => {
    it("otra empresa no ve, ni aplica, ni marca lo de esta; con el mismo id de carga en las dos, son dos cargas distintas", async () => {
      const a = await c.escenario();
      const b = await c.escenario();
      const sa = await conStock(c, a, "20");
      const sb = await conStock(c, b, "20");
      const ida = await abrirConteoDe(c, a, sa.dep);
      const idb = await abrirConteoDe(c, b, sb.dep);
      const ventaDeA = await movimientoEn(c, a, {
        dep: sa.dep,
        articulo: sa.articulo,
        cantidad: "-3",
        hechoEn: hace(-5),
      });
      const registro = nuevoId();
      valorDe(
        await contarEn(c, a.gerente, ida, sa.producto, "18", {
          id: registro,
          contadoEn: hace(-10),
        }),
      );
      expect(
        await contarEn(c, b.gerente, idb, sb.producto, "18", {
          id: registro,
          contadoEn: hace(-10),
        }),
      ).toEqual({
        ok: true,
        valor: { yaExistia: false },
      });
      expect(
        await c.contar("select count(*) as n from conteo_registro where id = $1", [registro]),
      ).toBe(2);
      expect(await c.aplicarConteo(b.gerente, ida)).toEqual({
        ok: false,
        error: "CONTEO_NO_ENCONTRADO",
      });
      expect(valorDe(await c.consultas.fichaDeConteo(b.gerente, { conteoId: ida }))).toBeNull();
      expect(
        valorDe(
          await c.consultas.candidatosDeConteo(b.gerente, {
            conteoId: ida,
            productoId: sa.producto,
          }),
        ),
      ).toBeNull();
      // Marcar un movimiento de la otra empresa es indistinguible de uno que no existe.
      expect(
        await c.aplicarConteo(b.gerente, idb, [
          { productoId: sb.producto, marcas: [{ movimientoId: ventaDeA, numero: 1 }] },
        ]),
      ).toEqual({ ok: false, error: "MOVIMIENTO_NO_EXPLICA" });
      expect(await estadoDe(ida)).toBe("ABIERTO");
      expect(await estadoDe(idb)).toBe("ABIERTO");
    });
  });
});
