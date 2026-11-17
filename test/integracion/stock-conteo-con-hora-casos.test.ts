import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  abrirConteoDe,
  conReloj,
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
 * E5, conteo con hora (spec §5, casos CF11 a CF17): equivocarse a tiempo y después de aplicar, la ventana de la hora (con el corte de la jornada a las
 * 04:00), el artículo no contado, el contado en cero, la existencia negativa y las unidades con decimales. Base real y casos de uso reales.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("stock: conteo con hora (casos)", () => {
  let c: MontajeDeStock;
  let e: EscenarioDeStock;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarStock(base);
    e = await c.escenario();
    // El corte de la jornada de la sucursal: a las 04:00 (lo de la madrugada es de la jornada del día anterior).
    await c.dueno.query("update sucursal set hora_de_corte = '04:00' where id = $1", [e.sucursal]);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const estadoDe = async (conteoId: string) =>
    (
      await c.filas<{ estado: string }>("select estado from conteo_fisico where id = $1", [
        conteoId,
      ])
    )[0]?.estado;

  it("CF11 (se equivoca quien cuenta, a tiempo): anota 14 y el gerente pide recontar: vale la ÚLTIMA cargada, queda todo registrado y no hay ajuste", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    await movimientoEn(c, e, {
      dep: s.dep,
      articulo: s.articulo,
      cantidad: "-3",
      hechoEn: hace(-5),
    });
    const operador = conReloj(e.operador, hace(0));
    valorDe(await contarEn(c, operador, id, s.producto, "14", { contadoEn: hace(-10) }));
    const primera = valorDe(await c.consultas.fichaDeConteo(e.gerente, { conteoId: id }));
    expect(primera?.registros[0]).toMatchObject({
      existenciaALaHora: "20.0000",
      diferenciaBruta: "-6.0000",
    });
    // Se recuenta: otra carga con otro id, 10:20.
    valorDe(
      await contarEn(c, conReloj(e.operador, hace(10)), id, s.producto, "17", {
        contadoEn: hace(10),
      }),
    );
    const ficha = valorDe(await c.consultas.fichaDeConteo(e.gerente, { conteoId: id }));
    expect(ficha?.registros.map((r) => [r.cantidadContada, r.vigente])).toEqual([
      ["14.0000", false],
      ["17.0000", true],
    ]);
    expect(ficha?.registros[1]).toMatchObject({
      existenciaALaHora: "17.0000",
      movidoDesdeLaHora: "0.0000",
      diferenciaBruta: "0.0000",
    });
    expect(
      valorDe(await c.aplicarConteo(conReloj(e.gerente, hace(10)), id)).movimientoId,
    ).toBeNull();
    expect(await c.existencia(s.dep, s.articulo)).toBe("17.0000");
    // Las dos cargas quedan (solo inserción); la explicación usa la segunda.
    expect(
      await c.contar("select count(*) as n from conteo_registro where conteo_id = $1", [id]),
    ).toBe(2);
    expect(await conteoDiferencia(c, id)).toEqual([
      expect.objectContaining({ contada: "17.0000", existencia_a_la_hora: "17.0000" }),
    ]);
  });

  it("CF12 (se equivoca y se aplica): el ajuste no se anula; un conteo posterior lo corrige con su propia hora y queda toda la trazabilidad", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    await movimientoEn(c, e, {
      dep: s.dep,
      articulo: s.articulo,
      cantidad: "-3",
      hechoEn: hace(-5),
    });
    valorDe(await contarEn(c, e.gerente, id, s.producto, "14", { contadoEn: hace(-10) }));
    const r = valorDe(
      await c.aplicarConteo(e.gerente, id, [
        { productoId: s.producto, motivo: "OTRA_SALIDA", detalle: "error de conteo" },
      ]),
    );
    expect(await c.existencia(s.dep, s.articulo)).toBe("11.0000");
    expect(
      await c.casos.anularMovimiento(e.gerente, {
        clave: nuevoId(),
        movimientoId: r.movimientoId as string,
        detalle: "Se contó mal",
      }),
    ).toEqual({ ok: false, error: "MOVIMIENTO_NO_ANULABLE" });
    // A las 11:00 se cuenta de nuevo: 17. Lo que el sistema creía a esa hora es 11, la diferencia es +6.
    const tarde = conReloj(e.gerente, hace(60));
    const id2 = valorDe(
      await c.casos.abrirConteo(tarde, { id: nuevoId(), depositoId: s.dep }),
    ).conteoId;
    valorDe(await contarEn(c, tarde, id2, s.producto, "17", { contadoEn: hace(50) }));
    expect(await c.aplicarConteo(tarde, id2)).toEqual({ ok: false, error: "MOTIVO_REQUERIDO" });
    valorDe(
      await c.aplicarConteo(tarde, id2, [
        {
          productoId: s.producto,
          motivo: "OTRA_ENTRADA",
          detalle: "se corrige el conteo anterior",
        },
      ]),
    );
    expect(await c.existencia(s.dep, s.articulo)).toBe("17.0000");
    expect(await conteoDiferencia(c, id)).toEqual([
      expect.objectContaining({
        motivo: "OTRA_SALIDA",
        detalle: "error de conteo",
        diferencia_final: "-6.0000",
      }),
    ]);
    expect(await conteoDiferencia(c, id2)).toEqual([
      expect.objectContaining({
        existencia_a_la_hora: "11.0000",
        diferencia_final: "6.0000",
        motivo: "OTRA_ENTRADA",
      }),
    ]);
    expect(valorDe(await c.consultas.verificarSaldos(e.gerente))).toEqual([]);
  });

  describe("CF13: la ventana de la hora (corte de la jornada a las 04:00 en Argentina)", () => {
    // 2026-11-11 02:00 en Argentina: la jornada vigente es la del 10/11 (todavía no pasaron las 04:00).
    const AHORA_X = new Date("2026-11-11T05:00:00Z");
    const comoX = () => conReloj(e.gerente, AHORA_X);
    const registrar = async (dep: string, producto: string, contadoEn: Date, quien = comoX()) => {
      const id = valorDe(
        await c.casos.abrirConteo(quien, { id: nuevoId(), depositoId: dep }),
      ).conteoId;
      const r = await contarEn(c, quien, id, producto, "0", { contadoEn });
      return { id, r };
    };

    it("una hora futura no se admite; la de la jornada anterior sí; la de hace dos jornadas, no", async () => {
      const s = await conStock(c, e, "0");
      const futura = await registrar(s.dep, s.producto, new Date(AHORA_X.getTime() + 60_000));
      expect(futura.r).toEqual({ ok: false, error: "FECHA_FUTURA_NO_ADMITIDA" });
      valorDe(await c.casos.cancelarConteo(e.gerente, { conteoId: futura.id, motivo: "Prueba" }));
      // 09/11 05:00 (jornada del 09/11, la anterior a la vigente del 10/11): admitida.
      const anterior = await registrar(s.dep, s.producto, new Date("2026-11-09T08:00:00Z"));
      expect(anterior.r).toEqual({ ok: true, valor: { yaExistia: false } });
      valorDe(await c.casos.cancelarConteo(e.gerente, { conteoId: anterior.id, motivo: "Prueba" }));
      // 08/11 05:00 (jornada del 08/11): fuera de la ventana.
      const vieja = await registrar(s.dep, s.producto, new Date("2026-11-08T08:00:00Z"));
      expect(vieja.r).toEqual({ ok: false, error: "HORA_FUERA_DE_VENTANA" });
      valorDe(await c.casos.cancelarConteo(e.gerente, { conteoId: vieja.id, motivo: "Prueba" }));
    });

    it("el límite es el corte: 03:59 del 09/11 es de la jornada del 08/11 (fuera) y 04:00 es de la del 09/11 (dentro)", async () => {
      const s = await conStock(c, e, "0");
      const antes = await registrar(s.dep, s.producto, new Date("2026-11-09T06:59:00Z"));
      expect(antes.r).toEqual({ ok: false, error: "HORA_FUERA_DE_VENTANA" });
      valorDe(await c.casos.cancelarConteo(e.gerente, { conteoId: antes.id, motivo: "Prueba" }));
      const justo = await registrar(s.dep, s.producto, new Date("2026-11-09T07:00:00Z"));
      expect(justo.r).toEqual({ ok: true, valor: { yaExistia: false } });
    });

    it("no puede ser anterior al momento en que se aplicó el último conteo del depósito (ese instante exacto sí)", async () => {
      const s = await conStock(c, e, "0");
      const T1 = new Date("2026-11-10T20:00:00Z");
      const primero = conReloj(e.gerente, T1);
      const id1 = valorDe(
        await c.casos.abrirConteo(primero, { id: nuevoId(), depositoId: s.dep }),
      ).conteoId;
      valorDe(await contarEn(c, primero, id1, s.producto, "0"));
      valorDe(await c.aplicarConteo(primero, id1));
      const antes = await registrar(s.dep, s.producto, new Date(T1.getTime() - 60_000));
      expect(antes.r).toEqual({ ok: false, error: "HORA_ANTERIOR_AL_ULTIMO_CONTEO" });
      valorDe(await c.casos.cancelarConteo(e.gerente, { conteoId: antes.id, motivo: "Prueba" }));
      const justo = await registrar(s.dep, s.producto, T1);
      expect(justo.r).toEqual({ ok: true, valor: { yaExistia: false } });
    });
  });

  it("CF14: se compara el INSTANTE, no la jornada: una venta de las 03:45 (misma jornada del 10/11 que un conteo de las 03:30) es posterior y es candidata", async () => {
    const s = await conStock(c, e, "10", {}, new Date("2026-11-11T05:00:00Z"));
    const ahora = conReloj(e.gerente, new Date("2026-11-11T08:00:00Z")); // 05:00 del 11/11
    const id = valorDe(
      await c.casos.abrirConteo(ahora, { id: nuevoId(), depositoId: s.dep }),
    ).conteoId;
    const venta = await movimientoEn(c, e, {
      dep: s.dep,
      articulo: s.articulo,
      cantidad: "-2",
      hechoEn: new Date("2026-11-11T06:45:00Z"),
    });
    valorDe(
      await contarEn(c, ahora, id, s.producto, "8", {
        contadoEn: new Date("2026-11-11T06:30:00Z"),
      }),
    );
    const candidatos = valorDe(
      await c.consultas.candidatosDeConteo(ahora, { conteoId: id, productoId: s.producto }),
    );
    expect(candidatos?.candidatos.map((x) => [x.movimientoId, x.cantidad])).toEqual([
      [venta, "-2.0000"],
    ]);
    const r = valorDe(
      await c.aplicarConteo(ahora, id, [
        { productoId: s.producto, marcas: [{ movimientoId: venta, numero: 1 }] },
      ]),
    );
    expect(r.movimientoId).toBeNull();
    expect(await c.existencia(s.dep, s.articulo)).toBe("8.0000");
  });

  it("CF15: lo que no se contó no cambia; contado en 0 con 20 deja −20; con existencia negativa (−2) contar 0 es un sobrante de +2", async () => {
    const uno = await conStock(c, e, "20");
    const intacto = await c.articulo(e);
    await movimientoEn(c, e, {
      dep: uno.dep,
      articulo: intacto.articulo,
      cantidad: "5",
      hechoEn: hace(-120),
    });
    const id = await abrirConteoDe(c, e, uno.dep);
    valorDe(await contarEn(c, e.gerente, id, uno.producto, "0", { contadoEn: hace(-10) }));
    valorDe(await c.aplicarConteo(e.gerente, id, [{ productoId: uno.producto, motivo: "MERMA" }]));
    expect(await c.existencia(uno.dep, uno.articulo)).toBe("0.0000");
    expect(await c.existencia(uno.dep, intacto.articulo)).toBe("5.0000");
    expect(await conteoDiferencia(c, id)).toEqual([
      expect.objectContaining({ diferencia_bruta: "-20.0000", diferencia_final: "-20.0000" }),
    ]);

    const negativo = await conStock(c, e, "0");
    await c.fijarNivel(e.empresa, "PERMITIR");
    await movimientoEn(c, e, {
      dep: negativo.dep,
      articulo: negativo.articulo,
      cantidad: "-2",
      hechoEn: hace(-60),
    });
    expect(await c.existencia(negativo.dep, negativo.articulo)).toBe("-2.0000");
    const id2 = await abrirConteoDe(c, e, negativo.dep);
    valorDe(await contarEn(c, e.gerente, id2, negativo.producto, "0", { contadoEn: hace(-10) }));
    expect(
      valorDe(await c.consultas.fichaDeConteo(e.gerente, { conteoId: id2 }))?.registros[0],
    ).toMatchObject({ existenciaALaHora: "-2.0000", diferenciaBruta: "2.0000" });
    valorDe(
      await c.aplicarConteo(e.gerente, id2, [
        { productoId: negativo.producto, motivo: "DEVOLUCION_DE_CLIENTE" },
      ]),
    );
    expect(await c.existencia(negativo.dep, negativo.articulo)).toBe("0.0000");
  });

  it("CF16: dos cargas del mismo artículo, con horas 10:00 y luego 09:40: vale la segunda CARGADA (no la de hora más tardía)", async () => {
    const s = await conStock(c, e, "20");
    const id = await abrirConteoDe(c, e, s.dep);
    valorDe(await contarEn(c, e.gerente, id, s.producto, "18", { contadoEn: hace(-10) }));
    valorDe(await contarEn(c, e.gerente, id, s.producto, "20", { contadoEn: hace(-30) }));
    const ficha = valorDe(await c.consultas.fichaDeConteo(e.gerente, { conteoId: id }));
    expect(ficha?.registros.map((r) => [r.cantidadContada, r.vigente])).toEqual([
      ["18.0000", false],
      ["20.0000", true],
    ]);
    expect(valorDe(await c.aplicarConteo(e.gerente, id)).movimientoId).toBeNull();
    expect(await c.existencia(s.dep, s.articulo)).toBe("20.0000");
  });

  it("CF17: unidades de peso: contar 2,5 kg con 3 kg deja −0,5 exacto, y 2500 g es lo mismo; una unidad que no es del artículo se rechaza", async () => {
    const articulo = { unidadBase: "KILOGRAMO", dimension: "MASA" };
    const s = await conStock(c, e, "3", articulo);
    const id = await abrirConteoDe(c, e, s.dep);
    valorDe(
      await contarEn(c, e.gerente, id, s.producto, "2500", {
        contadoEn: hace(-10),
        unidadId: "GRAMO",
      }),
    );
    expect(
      valorDe(await c.consultas.fichaDeConteo(e.gerente, { conteoId: id }))?.registros[0],
    ).toMatchObject({
      cantidadContada: "2.5000",
      existenciaALaHora: "3.0000",
      diferenciaBruta: "-0.5000",
    });
    expect(await contarEn(c, e.gerente, id, s.producto, "1", { unidadId: "LITRO" })).toEqual({
      ok: false,
      error: "DIMENSION_DISTINTA",
    });
    valorDe(await c.aplicarConteo(e.gerente, id, [{ productoId: s.producto, motivo: "MERMA" }]));
    expect(await c.existencia(s.dep, s.articulo)).toBe("2.5000");
    expect(await estadoDe(id)).toBe("APLICADO");
  });
});
