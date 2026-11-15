import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { montarComandas, type MundoDeComandas } from "./comandas-apoyo";
import { nuevaClave, nuevoId, valorDe, type EscenarioDeVentas } from "./ventas-apoyo";

/**
 * D3 (auditoría de salón, INTEGRACION §5), decisión del dueño CYN 72 (08/11/2026): «en la comanda va el nombre de cocina… porque así se sabe qué stock descuento»;
 * si el producto no tiene nombre de cocina, la comanda usa el comercial (`catalogo-y-niveles-maqueta.md`, «Si algo no tiene nombre de cocina, usa el comercial»).
 * La línea de la cuenta lo congela al agregarse (0055), como el precio y la descripción: renombrar el producto después no cambia lo que se pidió, ni a la cocina.
 * Previene: la cocina lee el nombre del cliente en vez del suyo (antes se imprimía `descripcion`).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });

describe.skipIf(base === null)("D3: la comanda lleva el nombre de cocina", () => {
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

  const producto = async (nombre: string, cocina: string | null): Promise<string> => {
    const id = await m.productoVendible(e.empresa, "1000", { nombre });
    if (cocina !== null) {
      await m.dueno.query(
        "update producto set nombre_de_cocina = $3 where id = $1 and empresa_id = $2",
        [id, e.empresa, cocina],
      );
    }
    return id;
  };

  const pedir = async (productoId: string, cantidad = "1") => {
    const cuenta = nuevoId();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
    const linea = nuevoId();
    valorDe(
      await m.casos.agregarLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: linea,
        productoId,
        opcionIds: [],
        cantidad,
      }),
    );
    return { cuenta, linea };
  };

  const enviar = async (cuenta: string) =>
    valorDe(
      await m.casosDeComandas.enviarACocina(e.gerente, {
        envioId: nuevoId(),
        cuentaId: cuenta,
        rotulo: "Mesa 5",
        claveIdempotencia: nuevaClave(),
      }),
    );

  const renglon = async (envioId: string) =>
    (
      await m.filas<{ nombre_de_cocina: string }>(
        "select nombre_de_cocina from renglon_de_envio where envio_id = $1",
        [envioId],
      )
    ).map((f) => f.nombre_de_cocina);

  it("con nombre de cocina, el papel dice el de cocina y no el comercial", async () => {
    const id = await producto("Bife a la criolla", "Medallón de bife de chorizo");
    const { cuenta } = await pedir(id);
    const envio = await enviar(cuenta);
    expect(await renglon(envio.envioId)).toEqual(["Medallón de bife de chorizo"]);
  });

  it("sin nombre de cocina, el papel dice el comercial", async () => {
    const id = await producto("Gaseosa cola", null);
    const { cuenta } = await pedir(id);
    const envio = await enviar(cuenta);
    expect(await renglon(envio.envioId)).toEqual(["Gaseosa cola"]);
  });

  it("el nombre de cocina se congela al agregar la línea: cambiarlo en el catálogo después no cambia lo pedido", async () => {
    const id = await producto("Pizza grande", "Muzzarella 8 porciones");
    const { cuenta, linea } = await pedir(id);
    await m.dueno.query(
      "update producto set nombre_de_cocina = 'Otro nombre' where id = $1 and empresa_id = $2",
      [id, e.empresa],
    );
    const guardado = await m.filas<{ nombre_de_cocina: string | null }>(
      "select nombre_de_cocina from linea_cuenta where id = $1",
      [linea],
    );
    expect(guardado[0]?.nombre_de_cocina).toBe("Muzzarella 8 porciones");
    const envio = await enviar(cuenta);
    expect(await renglon(envio.envioId)).toEqual(["Muzzarella 8 porciones"]);
  });

  it("la anulación parcial: el aviso lleva el nombre de cocina y el resto conserva el congelado", async () => {
    const id = await producto("Empanada de carne", "Empanada criolla");
    const { cuenta, linea } = await pedir(id, "3");
    await enviar(cuenta);
    const avisoId = nuevoId();
    const anulada = valorDe(
      await m.casosDeComandas.anularItemEnviado(e.gerente, {
        cuentaId: cuenta,
        lineaId: linea,
        cantidad: "1",
        motivo: "El cliente se arrepintió",
        avisoId,
        rotulo: "Mesa 5",
      }),
    );
    const aviso = await m.filas<{ nombre_de_cocina: string }>(
      "select nombre_de_cocina from aviso_de_anulacion where id = $1",
      [avisoId],
    );
    expect(aviso[0]?.nombre_de_cocina).toBe("Empanada criolla");
    const resto = await m.filas<{ nombre_de_cocina: string | null }>(
      "select nombre_de_cocina from linea_cuenta where id = $1",
      [anulada.lineaDelResto],
    );
    expect(resto[0]?.nombre_de_cocina).toBe("Empanada criolla");
  });
});
