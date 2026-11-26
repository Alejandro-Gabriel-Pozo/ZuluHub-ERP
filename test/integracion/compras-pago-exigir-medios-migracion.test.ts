import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { cuitUnico } from "./entorno";
import { nuevoId, valorDe } from "./clientes-apoyo";
import { montarCompras, type MontajeDeCompras } from "./compras-casos-apoyo";
import { acepta, intentoDelDueno, sinConfirmar } from "./fiscal-apoyo";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import { numeroUnico } from "./unicos";

/**
 * Migración 0109 (pago compuesto, paso 2): desde ahí todo pago trae sus medios, la suma de los medios es su total, el medio de la cabecera es coherente con sus líneas y el importe es positivo; la guarda frena con
 * datos que no cumplen (pagos sin medios, de importe 0, con suma que no cierra o con cabecera incoherente) y con un rol que no evade RLS; la reversión corre dos veces y deja todo como estaba.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const leer = (archivo: string) => readFile(join(CARPETA_DE_MIGRACIONES, archivo), "utf8");
const MIGRACION = "0109_pago_compuesto_exigir_medios.sql";

describe.skipIf(base === null)("0109: exigir medios en todo pago", () => {
  let c: MontajeDeCompras;
  let comprobanteId: string;
  let empresa: string;
  let persona: string;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    const e = await c.escenario();
    empresa = e.empresa;
    persona = e.gerente.personaId as string;
    valorDe(
      await c.casos.configurarCompras(e.gerente, { nivel: "CON_COMPROBANTE", versionEsperada: 1 }),
    );
    const deposito = await c.deposito(e);
    const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    comprobanteId = valorDe(
      await c.casos.registrarCompraConFactura(e.operador, {
        clave: nuevoId(),
        sucursalId: e.sucursal,
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
        factura: {
          tipo: "FACTURA_A",
          puntoDeVenta: 5,
          numero: numeroUnico(),
          fecha: "2026-10-10",
          lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
          totalSegunFactura: "2420.00",
          cuitDelProveedor: cuitUnico(),
        },
      }),
    ).comprobanteId as string;
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Un pago con cabecera y las líneas dadas, todo en la transacción abierta; `set constraints all immediate` trae la verificación diferida al momento. */
  const pagar = async (
    medio: string,
    importe: string,
    lineas: readonly (readonly [string, string])[],
    verificar = true,
  ) => {
    const cabecera = await intentoDelDueno(
      c.dueno,
      `insert into pago_de_comprobante (empresa_id, comprobante_id, fecha_de_pago, medio, importe, clave_idempotencia, huella, registrado_por)
         values ($1, $2, date '2026-10-11', $3, $4::numeric, $5, repeat('b', 64), $6) returning id`,
      [empresa, comprobanteId, medio, importe, nuevoId(), persona],
    );
    if (!cabecera.ok) return cabecera;
    const id = cabecera.rows[0]?.["id"];
    for (const [i, [m, v]] of lineas.entries()) {
      const linea = await intentoDelDueno(
        c.dueno,
        "insert into medio_de_un_pago (empresa_id, pago_id, numero, medio, importe) values ($1, $2, $3, $4, $5::numeric)",
        [empresa, id, i + 1, m, v],
      );
      if (!linea.ok) return linea;
    }
    return verificar ? intentoDelDueno(c.dueno, "set constraints all immediate") : cabecera;
  };

  it("un pago sin medios no se confirma; con sus medios y la suma exacta, sí", async () => {
    await sinConfirmar(c.dueno, async () => {
      expect(await pagar("TRANSFERENCIA", "2420.00", [])).toMatchObject({
        ok: false,
        restriccion: "medio_de_un_pago_suma_ck",
      });
    });
    await sinConfirmar(c.dueno, async () => {
      acepta(await pagar("TRANSFERENCIA", "2420.00", [["TRANSFERENCIA", "2420.00"]]));
    });
    await sinConfirmar(c.dueno, async () => {
      acepta(
        await pagar("COMPUESTO", "2420.00", [
          ["EFECTIVO", "1000.00"],
          ["QR", "1420.00"],
        ]),
      );
    });
  });

  it("la suma de los medios es EXACTAMENTE el total (un centavo de menos o de más se rechaza) y la cabecera tiene que coincidir con sus líneas", async () => {
    for (const segunda of ["1419.99", "1420.01"]) {
      await sinConfirmar(c.dueno, async () => {
        expect(
          await pagar("COMPUESTO", "2420.00", [
            ["EFECTIVO", "1000.00"],
            ["QR", segunda],
          ]),
        ).toMatchObject({ ok: false, restriccion: "medio_de_un_pago_suma_ck" });
      });
    }
    await sinConfirmar(c.dueno, async () => {
      expect(
        await pagar("QR", "2420.00", [
          ["EFECTIVO", "1000.00"],
          ["QR", "1420.00"],
        ]),
      ).toMatchObject({ ok: false, restriccion: "pago_medio_coherente_ck" });
    });
    await sinConfirmar(c.dueno, async () => {
      expect(await pagar("COMPUESTO", "2420.00", [["QR", "2420.00"]])).toMatchObject({
        ok: false,
        restriccion: "pago_medio_coherente_ck",
      });
    });
  });

  it("el importe de un pago es positivo: cero lo rechaza el CHECK nuevo y un negativo, el de siempre", async () => {
    for (const [importe, restriccion] of [
      ["0", "pago_importe_positivo_ck"],
      ["-1.00", "pago_importe_ck"],
    ]) {
      await sinConfirmar(c.dueno, async () => {
        expect(await pagar("TRANSFERENCIA", importe as string, [], false)).toMatchObject({
          ok: false,
          restriccion,
        });
      });
    }
  });

  it("la guarda de la migración frena (55000) con pagos sin medios, de importe 0, con suma que no cierra o con cabecera incoherente, y deja pasar datos sanos", async () => {
    const guarda = /DO \$\$[\s\S]*?\$\$;/.exec(await leer(MIGRACION))?.[0] ?? "";
    expect(guarda).toContain("RAISE EXCEPTION");
    const codigoDe = async (preparar: () => Promise<void>) =>
      sinConfirmar(c.dueno, async () => {
        // Los datos «ya existentes» se arman sin el disparador ni el CHECK nuevos (antes de 0109 no existían).
        await c.dueno.query(
          "alter table pago_de_comprobante disable trigger pago_de_comprobante_verificar_medios",
        );
        await c.dueno.query(
          "alter table pago_de_comprobante drop constraint pago_importe_positivo_ck",
        );
        await preparar();
        const r = await intentoDelDueno(c.dueno, guarda);
        return r.ok ? "OK" : r.codigo;
      });
    expect(await codigoDe(() => Promise.resolve())).toBe("OK");
    expect(
      await codigoDe(async () => {
        await pagar("TRANSFERENCIA", "2420.00", [["TRANSFERENCIA", "2420.00"]], false);
      }),
    ).toBe("OK");
    for (const [medio, importe, lineas] of [
      ["TRANSFERENCIA", "2420.00", []],
      ["TRANSFERENCIA", "0", []],
      ["TRANSFERENCIA", "2420.00", [["TRANSFERENCIA", "2419.99"]]],
      [
        "QR",
        "2420.00",
        [
          ["EFECTIVO", "1000.00"],
          ["QR", "1420.00"],
        ],
      ],
      ["COMPUESTO", "2420.00", [["QR", "2420.00"]]],
    ] as const) {
      expect(
        await codigoDe(async () => {
          await pagar(medio, importe, lineas, false);
        }),
      ).toBe("55000");
    }
  });

  it("la guarda de RLS frena (55000) con un rol que no la evade y deja pasar al que sí", async () => {
    const guarda = /IF row_security_active[\s\S]*?END IF;/.exec(await leer(MIGRACION))?.[0] ?? "";
    expect(guarda).not.toBe("");
    const bloque = `DO $$ BEGIN ${guarda} END $$`;
    await sinConfirmar(c.dueno, async () => {
      acepta(await intentoDelDueno(c.dueno, bloque));
      await c.dueno.query("set local role pedernal_app");
      const frena = await intentoDelDueno(c.dueno, bloque);
      expect(frena.ok ? "" : frena.codigo).toBe("55000");
    });
  });

  it("la reversión quita el disparador y el CHECK, no pierde datos, corre dos veces y borra su fila de `migracion`", async () => {
    const reversion = await leer("reversiones/0109_revertir_pago_compuesto_exigir_medios.sql");
    await sinConfirmar(c.dueno, async () => {
      acepta(await intentoDelDueno(c.dueno, reversion));
      acepta(await intentoDelDueno(c.dueno, reversion));
      const quedan = await c.dueno.query<{ n: string }>(
        `select (select count(*) from pg_trigger where tgname = 'pago_de_comprobante_verificar_medios')
              + (select count(*) from pg_constraint where conname = 'pago_importe_positivo_ck') as n`,
      );
      expect(quedan.rows[0]?.n).toBe("0");
      const fila = await c.dueno.query("select 1 from migracion where nombre = $1", [MIGRACION]);
      expect(fila.rowCount).toBe(0);
      // Sin el paso 2 un pago sin líneas vuelve a poder confirmarse (estado de antes de 0109).
      acepta(await pagar("TRANSFERENCIA", "2420.00", [], true));
    });
    await sinConfirmar(c.dueno, async () => {
      const existe = await c.dueno.query(
        "select 1 from pg_trigger where tgname = 'pago_de_comprobante_verificar_medios'",
      );
      expect(existe.rowCount).toBe(1);
    });
  });
});
