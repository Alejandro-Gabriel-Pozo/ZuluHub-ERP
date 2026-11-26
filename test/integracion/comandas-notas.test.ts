import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarComandas, type MundoDeComandas } from "./comandas-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * La nota libre de un plato (SAL-G, `cambiarNota` de comandas) con los casos de uso reales y una base real: se cambia solo mientras no se envió, repetir la misma no cambia nada, el envío copia la nota VIVA a la foto y el papel
 * la imprime bajo el plato; una nota inválida no escribe nada; no cambia precio ni línea de ventas; enviar y editar a la vez nunca dejan un papel con una nota distinta de la guardada; sin permiso o de otra empresa no se escribe.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const codigo = (r: { ok: boolean; error?: unknown }) =>
  r.ok ? null : typeof r.error === "string" ? r.error : "otro";

describe.skipIf(base === null)("comandas: la nota libre del plato", () => {
  let m: MundoDeComandas;
  let e: EscenarioDeVentas;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarComandas(base);
    e = await m.escenario();
  });
  afterAll(async () => {
    await m.cerrar();
  });

  const cambiar = (cuentaId: string, lineaId: string, nota: string | null, ctx = e.gerente) =>
    m.casosDeComandas.cambiarNota(ctx, { cuentaId, lineaId, nota });
  const enviar = (cuentaId: string) =>
    m.casosDeComandas.enviarACocina(e.gerente, {
      envioId: nuevoId(),
      cuentaId,
      rotulo: "Mesa 5",
      claveIdempotencia: nuevaClave(),
    });
  const notaViva = async (lineaId: string) =>
    (
      await m.filas<{ nota: string | null }>(
        "select nota from linea_de_comanda where linea_id = $1",
        [lineaId],
      )
    )[0]?.nota ?? null;
  const notaDeLaFoto = async (lineaId: string) =>
    (
      await m.filas<{ nota: string | null }>(
        "select nota from renglon_de_envio where linea_id = $1 and rol = 'SALE'",
        [lineaId],
      )
    )[0]?.nota;

  it("cambiar la nota solo vale sin enviar; repetir la misma nota no cambia nada y la nota nueva viaja con el envío", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 1);
    const linea = lineas[0] as string;
    expect(valorDe(await cambiar(cuenta, linea, "  sin cebolla "))).toEqual({
      nota: "sin cebolla",
      yaEstaba: false,
    });
    expect(valorDe(await cambiar(cuenta, linea, "sin cebolla"))).toEqual({
      nota: "sin cebolla",
      yaEstaba: true,
    });
    expect(valorDe(await cambiar(cuenta, linea, "sin cebolla y sin sal")).yaEstaba).toBe(false);
    expect(await notaViva(linea)).toBe("sin cebolla y sin sal");

    const envio = valorDe(await enviar(cuenta));
    // La foto lleva exactamente la nota guardada y el papel la imprime bajo el plato, sin precios.
    expect(await notaDeLaFoto(linea)).toBe("sin cebolla y sin sal");
    const papel = valorDe(
      await m.consultasDeComandas.documentoParaImprimir(e.gerente, {
        documentoTipo: "COMANDA",
        documentoId: envio.envioId,
        copia: false,
      }),
    );
    const textos = papel.lineas.map((l) => l.texto);
    expect(textos.some((t) => t.includes("sin cebolla y sin sal"))).toBe(true);

    // Ya enviado: la nota no cambia (ni se quita) y la foto sigue igual.
    expect(codigo(await cambiar(cuenta, linea, "otra"))).toBe("LINEA_YA_ENVIADA");
    expect(codigo(await cambiar(cuenta, linea, null))).toBe("LINEA_YA_ENVIADA");
    expect(await notaViva(linea)).toBe("sin cebolla y sin sal");
    expect(await notaDeLaFoto(linea)).toBe("sin cebolla y sin sal");
  });

  it("vacía o nula la quita (sin nota = nulo, no texto vacío) y repetirlo no cambia nada", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 1);
    const linea = lineas[0] as string;
    valorDe(await cambiar(cuenta, linea, "sin sal"));
    expect(valorDe(await cambiar(cuenta, linea, "  "))).toEqual({ nota: null, yaEstaba: false });
    expect(await notaViva(linea)).toBeNull();
    expect(valorDe(await cambiar(cuenta, linea, null)).yaEstaba).toBe(true);
    valorDe(await enviar(cuenta));
    expect(await notaDeLaFoto(linea)).toBeNull();
  });

  it("una nota inválida (largo, controles, HTML, emojis) es NOTA_INVALIDA y no escribe nada; el plato queda como estaba", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 1);
    const linea = lineas[0] as string;
    valorDe(await cambiar(cuenta, linea, "sin sal"));
    for (const mala of ["x".repeat(121), "a\nb", "a\u0007b", "<b>x</b>", "con 🍕", "=SUMA(A1)"]) {
      expect(codigo(await cambiar(cuenta, linea, mala)), JSON.stringify(mala)).toBe(
        "NOTA_INVALIDA",
      );
    }
    expect(await notaViva(linea)).toBe("sin sal");
  });

  it("la nota NO cambia el precio ni la línea de ventas (total, cantidad, precio congelado)", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 2, "3");
    const foto = () =>
      m.filas(
        "select id, cantidad, precio_unitario, estado, (select total_provisorio from cuenta_consumo where id = $1) as total from linea_cuenta where cuenta_id = $1 order by id",
        [cuenta],
      );
    const antes = await foto();
    valorDe(await cambiar(cuenta, lineas[0] as string, "sin cebolla"));
    valorDe(await enviar(cuenta));
    expect(await foto()).toEqual(antes);
  });

  it("ENVIAR y EDITAR a la vez nunca dejan una foto distinta de la nota guardada: o sale con la nota nueva o sale con la vieja y la edición recibe LINEA_YA_ENVIADA", async () => {
    let gano = 0;
    let perdio = 0;
    for (let i = 0; i < 12; i++) {
      const { cuenta, lineas } = await m.cuentaConLineas(e, 1);
      const linea = lineas[0] as string;
      valorDe(await cambiar(cuenta, linea, "vieja"));
      const [envio, edicion] = await Promise.all([enviar(cuenta), cambiar(cuenta, linea, "nueva")]);
      expect(envio.ok).toBe(true);
      const foto = await notaDeLaFoto(linea);
      expect(foto).toBe(await notaViva(linea));
      if (edicion.ok) {
        gano++;
        expect(foto).toBe("nueva");
      } else {
        perdio++;
        expect(codigo(edicion)).toBe("LINEA_YA_ENVIADA");
        expect(foto).toBe("vieja");
      }
    }
    expect(gano + perdio).toBe(12);
  });

  it("un plato que ESPERA («sale después») sale en el papel con su nota viva, y editarla después sigue valiendo (no se envió)", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 2);
    const [sale, espera] = lineas as [string, string];
    valorDe(
      await m.casosDeComandas.cambiarSalida(e.gerente, {
        cuentaId: cuenta,
        lineaId: espera,
        salida: "DESPUES",
      }),
    );
    valorDe(await cambiar(cuenta, espera, "bien cocida"));
    valorDe(await enviar(cuenta));
    expect(
      (
        await m.filas<{ nota: string | null }>(
          "select nota from renglon_de_envio where linea_id = $1 and rol = 'ESPERA'",
          [espera],
        )
      )[0]?.nota,
    ).toBe("bien cocida");
    expect(await notaDeLaFoto(sale)).toBeNull();
    expect(valorDe(await cambiar(cuenta, espera, "poco cocida")).yaEstaba).toBe(false);
    expect(await notaViva(espera)).toBe("poco cocida");
  });

  it("PERMISOS Y AISLAMIENTO: sin persona no se escribe; una línea de otra empresa o de otra cuenta es «no encontrada» y no cambia", async () => {
    const { cuenta, lineas } = await m.cuentaConLineas(e, 1);
    const linea = lineas[0] as string;
    const otra = await m.escenario();
    const ajena = await m.cuentaConLineas(otra, 1);
    expect((await cambiar(cuenta, linea, "x", { ...e.gerente, personaId: null })).ok).toBe(false);
    expect((await cambiar(ajena.cuenta, ajena.lineas[0] as string, "x", e.gerente)).ok).toBe(false);
    expect((await cambiar(cuenta, ajena.lineas[0] as string, "x")).ok).toBe(false);
    expect(codigo(await cambiar("no-es-un-id", linea, "x"))).not.toBeNull();
    expect(await notaViva(linea)).toBeNull();
    expect(await notaViva(ajena.lineas[0] as string)).toBeNull();
  });
});
