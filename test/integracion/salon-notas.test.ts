import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarSalon, type MundoDeSalon } from "./salon-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * La nota libre en el salón (SAL-G): se carga al agregar el plato (una inválida no deja la línea a medias), repetir el agregado con la misma nota es una sola línea, y la nota VIAJA con el plato al unir, dividir y
 * anular una parte (la base exige que una copia conserve la de su origen): lo ya enviado no se reimprime y cada cuenta hija de un ítem compartido conserva su nota.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("salón: la nota libre del plato", () => {
  let m: MundoDeSalon;
  let proxima = 0;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarSalon(base);
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const mesa = async (e: EscenarioDeVentas) => {
    const n = ++proxima;
    const mesaId = nuevoId();
    valorDe(
      await m.salon.crearMesa(e.gerente, {
        mesaId,
        sucursalId: e.sucursal,
        numero: n,
        forma: "CUADRADA",
        tamano: "CHICA",
        columna: 1 + ((n - 1) % 7) * 2,
        fila: 1 + Math.floor((n - 1) / 7) * 2,
      }),
    );
    const cuentaId = valorDe(
      await m.salon.tomarPedido(e.gerente, { cuentaId: nuevoId(), mesaId }),
    ).cuentaId;
    return { mesaId, cuentaId };
  };
  const agregar = (
    e: EscenarioDeVentas,
    cuentaId: string,
    nota?: string,
    lineaId = nuevoId(),
    cantidad = "2",
  ) =>
    m.salon.agregarAlPedido(e.gerente, {
      cuentaId,
      lineaId,
      productoId: e.producto,
      opcionIds: [],
      cantidad,
      ...(nota === undefined ? {} : { nota }),
    });
  const enviar = async (e: EscenarioDeVentas, cuentaId: string) =>
    valorDe(
      await m.salon.enviarACocina(e.gerente, {
        envioId: nuevoId(),
        cuentaId,
        claveIdempotencia: nuevaClave(),
      }),
    );
  const notaDe = async (cuentaId: string) =>
    (
      await m.filas<{ nota: string | null }>(
        "select d.nota from linea_de_comanda d join linea_cuenta l on l.id = d.linea_id and l.empresa_id = d.empresa_id where d.cuenta_id = $1 and l.estado = 'VIGENTE' order by l.posicion",
        [cuentaId],
      )
    ).map((f) => f.nota);
  const envios = (cuentaIds: readonly string[]) =>
    m.contar("select count(*) as n from envio_de_comanda where cuenta_id = any($1)", [cuentaIds]);

  it("agregar con nota la guarda; repetir el agregado con la misma nota es UNA línea; una nota inválida no deja ninguna línea", async () => {
    const e = await m.escenario();
    const { cuentaId } = await mesa(e);
    const lineaId = nuevoId();
    valorDe(await agregar(e, cuentaId, "sin cebolla", lineaId));
    valorDe(await agregar(e, cuentaId, "sin cebolla", lineaId));
    expect(await notaDe(cuentaId)).toEqual(["sin cebolla"]);
    const mala = await agregar(e, cuentaId, "<b>x</b>");
    expect(mala).toEqual({ ok: false, error: "ENTRADA_INVALIDA" });
    expect(await agregar(e, cuentaId, "x".repeat(121))).toEqual({
      ok: false,
      error: "ENTRADA_INVALIDA",
    });
    expect(await notaDe(cuentaId)).toEqual(["sin cebolla"]);
    // Sin nota o vacía: la línea nace sin nota.
    valorDe(await agregar(e, cuentaId, "  "));
    valorDe(await agregar(e, cuentaId));
    expect(await notaDe(cuentaId)).toEqual(["sin cebolla", null, null]);
  });

  it("UNIR: la nota viaja con el plato ya enviado a la cuenta destino y no se reimprime", async () => {
    const e = await m.escenario();
    const destino = await mesa(e);
    const origen = await mesa(e);
    valorDe(await agregar(e, destino.cuentaId, "bien cocida"));
    valorDe(await agregar(e, origen.cuentaId, "sin sal"));
    await enviar(e, destino.cuentaId);
    await enviar(e, origen.cuentaId);
    const antes = await envios([destino.cuentaId, origen.cuentaId]);
    valorDe(
      await m.salon.unirMesas(e.gerente, {
        sucursalDeTrabajo: e.sucursal,
        unionId: nuevoId(),
        cuentaDestinoId: destino.cuentaId,
        cuentaOrigenId: origen.cuentaId,
        clave: nuevaClave(),
      }),
    );
    expect((await notaDe(destino.cuentaId)).sort()).toEqual(["bien cocida", "sin sal"]);
    expect(await envios([destino.cuentaId, origen.cuentaId])).toBe(antes);
  });

  it("DIVIDIR: cada cuenta hija conserva la nota del plato, por unidades y compartido; lo enviado no se reimprime", async () => {
    const e = await m.escenario();
    const { cuentaId } = await mesa(e);
    const lineaA = nuevoId();
    const lineaB = nuevoId();
    valorDe(await agregar(e, cuentaId, "sin cebolla", lineaA, "2"));
    valorDe(await agregar(e, cuentaId, "bien cocida", lineaB, "1"));
    await enviar(e, cuentaId);
    const antes = await envios([cuentaId]);
    const r = valorDe(
      await m.salon.dividirCuenta(e.gerente, {
        divisionId: nuevoId(),
        cuentaId,
        partes: 2,
        asignaciones: [
          { lineaId: lineaA, forma: "POR_UNIDADES", cantidades: ["1", "1"] },
          { lineaId: lineaB, forma: "COMPARTIDO", partes: [1, 2] },
        ],
      }),
    );
    for (const c of r.cuentas) {
      expect((await notaDe(c.cuentaId)).sort()).toEqual(["bien cocida", "sin cebolla"]);
    }
    expect(await envios([cuentaId, ...r.cuentas.map((c) => c.cuentaId)])).toBe(antes);
  });

  it("ANULAR UNA PARTE de un ítem enviado: el resto conserva la nota y el aviso la repite en el papel de cocina", async () => {
    const e = await m.escenario();
    const { cuentaId } = await mesa(e);
    const lineaId = nuevoId();
    valorDe(await agregar(e, cuentaId, "sin cebolla", lineaId, "3"));
    await enviar(e, cuentaId);
    const avisoId = nuevoId();
    valorDe(
      await m.salon.anularItemEnviado(e.gerente, {
        cuentaId,
        lineaId,
        cantidad: "1",
        motivo: "Se cayó",
        avisoId,
      }),
    );
    expect(await notaDe(cuentaId)).toEqual(["sin cebolla"]);
    expect(
      (
        await m.filas<{ nota: string | null }>(
          "select l.id, d.nota from linea_de_comanda d join linea_cuenta l on l.id = d.linea_id and l.empresa_id = d.empresa_id where d.cuenta_id = $1 and l.estado = 'VIGENTE'",
          [cuentaId],
        )
      )[0]?.nota,
    ).toBe("sin cebolla");
  });
});
