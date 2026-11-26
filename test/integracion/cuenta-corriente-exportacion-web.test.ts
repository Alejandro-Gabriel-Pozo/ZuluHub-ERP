import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { leerZipComoTextos } from "../../src/adaptadores/xlsx/leer-zip-de-prueba";
import { crearApoyoDeLaExportacionDeCuentaCorriente } from "../../src/composicion/apoyo-de-exportacion-de-cuenta-corriente";
import {
  exportarLaCuentaCorriente,
  type DependenciasDeLaExportacionDeCuentaCorriente,
} from "../../src/composicion/cuenta-corriente-exportacion-web";
import { crearEscritorDePlanilla } from "../../src/composicion/escritor-de-planilla";
import {
  crearCasosDeUsoDeCuentaCorriente,
  crearConsultasDeCuentaCorriente,
  type TxDeConsultasDeCuentaCorriente,
  type TxDeCuentaCorriente,
  type TxDeEstadoDeCuenta,
} from "../../src/modulos/cuenta_corriente/publico";
import type { Transacciones } from "../../src/puertos/transacciones";
import { HUELLA, claveNueva } from "./caja-apoyo";
import { cuitUnico, sufijoUnico } from "./unicos";
import {
  REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE,
  cuentaConLinea,
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * El archivo de la cuenta corriente de punta a punta por la composición web (CC-5 D): el caso de uso real con su apoyo, los textos del catálogo y el escritor real. Se abre el .xlsx y se
 * mira lo que vería quien lo abre: una hoja plana, importes como números exactos, el saldo de cada cliente IGUAL al de su ficha, ninguna fórmula (el nombre de un cliente no puede empezar como una: lo impide la base, y el escritor lo neutraliza igual, ver `src/composicion/cuenta-corriente-exportacion-web.test.ts`), y que otra empresa o quien no tiene
 * permiso no ve nada. Previene: un archivo cuya suma por cliente no es el saldo de la ficha, un cliente de otra empresa en el archivo y una
 * constancia que deja los datos adentro.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type TxDeLaCuentaCorriente = TxDeCuentaCorriente &
  TxDeConsultasDeCuentaCorriente &
  TxDeEstadoDeCuenta;

/** Los días entre 1899-12-30 y la fecha: así guarda Excel una fecha (su número de serie). */
const serieDeExcel = (fecha: string): number =>
  Math.round((Date.parse(`${fecha}T00:00:00Z`) - Date.parse("1899-12-30T00:00:00Z")) / 86_400_000);

/** Una celda ya leída: lo que vería quien abre el archivo. */
type CeldaLeida = Readonly<{ tipo: "texto" | "numero" | "vacia"; valor: string }>;

/** La hoja del .xlsx como filas de celdas por letra de columna, con los textos compartidos ya resueltos. */
function leerHoja(zip: ReadonlyMap<string, string>): ReadonlyMap<number, Map<string, CeldaLeida>> {
  const compartidos = [
    ...(zip.get("xl/sharedStrings.xml") ?? "").matchAll(/<si>(.*?)<\/si>/gs),
  ].map((m) =>
    [...(m[1] ?? "").matchAll(/<t[^>]*>(.*?)<\/t>/gs)]
      .map((t) => (t[1] ?? "").replaceAll("&quot;", '"').replaceAll("&amp;", "&"))
      .join(""),
  );
  const xml = zip.get("xl/worksheets/sheet1.xml") ?? "";
  const filas = new Map<number, Map<string, CeldaLeida>>();
  for (const c of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
    const [, columna, fila, atributos, interior] = c;
    const valor = /<v>(.*?)<\/v>/s.exec(interior ?? "")?.[1];
    const celda: CeldaLeida =
      valor === undefined
        ? { tipo: "vacia", valor: "" }
        : /t="s"/.test(atributos ?? "")
          ? { tipo: "texto", valor: compartidos[Number(valor)] ?? "" }
          : { tipo: "numero", valor };
    const numero = Number(fila);
    const deLaFila = filas.get(numero) ?? new Map<string, CeldaLeida>();
    deLaFila.set(columna ?? "", celda);
    filas.set(numero, deLaFila);
  }
  return filas;
}

/** «-600.5» → centavos exactos (sin pasar por coma flotante). */
function centavos(texto: string): bigint {
  const negativo = texto.startsWith("-");
  const [entera = "0", fraccion = ""] = (negativo ? texto.slice(1) : texto).split(".");
  const valor = BigInt(entera) * 100n + BigInt(fraccion.padEnd(2, "0").slice(0, 2));
  return negativo ? -valor : valor;
}

describe.skipIf(base === null)("composición web: archivo de la cuenta corriente (CC-5 D)", () => {
  let m: MundoDeVentas;
  let e: EscenarioDeVentas;
  let otra: EscenarioDeVentas;
  let d: DependenciasDeLaExportacionDeCuentaCorriente;
  let consultas: ReturnType<typeof crearConsultasDeCuentaCorriente>;
  const registrados: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, { conexiones: 16, cuentaCorriente: true });
    e = await m.escenario();
    otra = await m.escenario();
    const transacciones = m.entorno as unknown as Transacciones<TxDeLaCuentaCorriente>;
    const dependencias = { transacciones, reglas: REGLAS_DE_PRUEBA_CON_CUENTA_CORRIENTE };
    const casos = crearCasosDeUsoDeCuentaCorriente({
      ...dependencias,
      apoyoDeLaExportacion: crearApoyoDeLaExportacionDeCuentaCorriente(),
    });
    consultas = crearConsultasDeCuentaCorriente(dependencias);
    d = {
      casos: () => ({ exportarCuentaCorriente: casos.exportarCuentaCorriente }),
      escritor: crearEscritorDePlanilla(),
      respuesta: { registrar: (x) => registrados.push(x) },
    };
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  const cliente = async (
    de: EscenarioDeVentas = e,
    nombre = `Cliente ${sufijoUnico()}`,
  ): Promise<Readonly<{ id: string; nombre: string; cuit: string }>> => {
    const id = randomUUID();
    const cuit = cuitUnico();
    await m.dueno.query(
      `insert into parte (id, empresa_id, idempotencia_alta, naturaleza, nombre, documento_tipo, documento_numero, creado_por)
       values ($1, $2, gen_random_uuid(), 'JURIDICA', $3, 'CUIT', $4, $5)`,
      [id, de.empresa, nombre, cuit, de.gerente.personaId],
    );
    await m.dueno.query(
      "insert into parte_rol (empresa_id, parte_id, rol, activo) values ($1, $2, 'CUSTOMER', true)",
      [de.empresa, id],
    );
    await m.dueno.query(
      `insert into cuenta_del_cliente (empresa_id, parte_id, plazo_dias, limite, clave_idempotencia, huella, habilitada_por)
       values ($1, $2, 30, '100000.00', $3, $4, $5)`,
      [de.empresa, id, claveNueva(), HUELLA, de.gerente.personaId],
    );
    return { id, nombre, cuit };
  };
  const aCuenta = async (clienteId: string, de: EscenarioDeVentas = e) => {
    const { cuenta } = await cuentaConLinea(m, de, de.gerente);
    return valorDe(
      await m.casos.cerrarCuenta(de.gerente, {
        cuentaId: cuenta,
        ejemplarId: nuevoId(),
        clienteId,
      }),
    );
  };
  const cobrar = async (
    t: Readonly<{ ticketId: string; ejemplarId: string }>,
    cobros: readonly (readonly [string, string])[] = [["EFECTIVO", "1000.00"]],
  ) => {
    const caja = await m.cajaAbierta(e);
    return valorDe(
      await m.casos.cobrar(e.gerente, {
        claveIdempotencia: nuevaClave(),
        ticketId: t.ticketId,
        ejemplarId: t.ejemplarId,
        cajaId: caja.cajaId,
        cobros: cobros.map(([medio, monto]) => ({
          medioDePagoId: caja.medios[medio] as string,
          cuentaDeCobroId: null,
          importe: { moneda: "ARS", monto },
        })),
      }),
    );
  };
  const anular = async (t: Readonly<{ ticketId: string; ejemplarId: string }>) =>
    valorDe(
      await m.casos.anularTicket(e.gerente, {
        claveIdempotencia: nuevaClave(),
        ticketId: t.ticketId,
        ejemplarBaseId: t.ejemplarId,
        ejemplarNuevoId: nuevoId(),
        motivo: "Error del cajero",
        sucursalDeTrabajo: e.sucursal,
      }),
    );
  const bajar = async (de: EscenarioDeVentas = e) => {
    const r = await exportarLaCuentaCorriente(d, de.gerente);
    if (!r.ok) throw new Error(`no salió el archivo: ${JSON.stringify(r.error)}`);
    const zip = leerZipComoTextos(r.dato.contenido);
    return { nombre: r.dato.nombre, zip, filas: leerHoja(zip) };
  };
  /** Las filas de la hoja de un cliente (por su nombre en la columna A), con la letra de cada columna. */
  const deUnCliente = (filas: ReturnType<typeof leerHoja>, nombre: string) =>
    [...filas.entries()]
      .filter(([n, f]) => n > 1 && f.get("A")?.valor === nombre)
      .map(([, f]) => f);

  it("el gerente baja el archivo: una hoja plana, encabezados, importes como números exactos, fechas como fecha y ninguna fórmula", async () => {
    const c = await cliente();
    const aCobrar = await aCuenta(c.id);
    await aCuenta(c.id);
    await cobrar(aCobrar);
    const { nombre, zip, filas } = await bajar();
    expect(nombre).toBe("cuenta_corriente_2026-11-09.xlsx");
    expect(zip.get("xl/workbook.xml")).toContain('name="Cuenta corriente"');
    const encabezados = [...(filas.get(1)?.values() ?? [])].map((x) => x.valor);
    // Los textos que el catálogo ya tiene aprobados se reutilizan; los diez nuevos están en DEC-CCL-007.
    for (const esperado of [
      "Cliente",
      "Importe",
      "Fecha de negocio",
      "Moneda",
      "Sucursal",
      "Medio de pago",
      "Estado",
    ]) {
      expect(encabezados).toContain(esperado);
    }
    const suyas = deUnCliente(filas, c.nombre);
    // 2 cargos + 1 cobranza.
    expect(suyas).toHaveLength(3);
    for (const f of suyas) {
      expect(f.get("B")).toEqual({ tipo: "texto", valor: c.cuit });
      // Fecha de negocio y vencimiento: celdas de fecha (número de serie), no texto.
      expect(f.get("C")).toEqual({ tipo: "numero", valor: String(serieDeExcel("2026-11-09")) });
      expect(f.get("F")?.tipo).toBe("numero");
    }
    expect(suyas[0]?.get("D")).toEqual({
      tipo: "numero",
      valor: String(serieDeExcel("2026-12-09")),
    });
    expect(suyas.map((f) => f.get("F")?.valor)).toEqual(["1000", "1000", "-1000"]);
    for (const [archivo, xml] of zip) {
      if (archivo.startsWith("xl/worksheets/")) expect(xml).not.toContain("<f");
    }
  });

  it("el saldo del archivo de cada cliente es EXACTAMENTE el saldo de su ficha (cargos, cobranza con dos medios y una anulación con su espejo)", async () => {
    const c = await cliente();
    await aCuenta(c.id);
    const dosMedios = await aCuenta(c.id);
    await cobrar(dosMedios, [
      ["EFECTIVO", "600.50"],
      ["TARJETA_DEBITO", "399.50"],
    ]);
    await anular(await aCuenta(c.id));
    const { filas } = await bajar();
    const suyas = deUnCliente(filas, c.nombre);
    // 3 cargos + cobranza en 2 filas (una por medio) + el espejo de la anulación = 6.
    expect(suyas).toHaveLength(6);
    const enElArchivo = suyas.reduce((a, f) => a + centavos(f.get("F")?.valor ?? "0"), 0n);
    const ficha = valorDe(await consultas.verEstadoDeCuenta(e.gerente, { parteId: c.id }));
    expect(ficha.saldo).toEqual({ moneda: "ARS", monto: "1000.00" });
    expect(enElArchivo).toBe(centavos(ficha.saldo.monto));
    // La cobranza sale con el medio de cada parte y con su texto de catálogo (el mismo de compras), y los centavos no se pierden.
    const medios = suyas
      .filter((f) => f.get("N")?.tipo === "texto")
      .map((f) => [f.get("N")?.valor, f.get("F")?.valor]);
    expect(medios.sort()).toEqual([
      ["Efectivo", "-600.5"],
      ["Tarjeta de débito", "-399.5"],
    ]);
    // «Anulado» con el texto aprobado; el resto, el código.
    expect(suyas.filter((f) => f.get("O")?.valor === "Anulado")).toHaveLength(2);
    // Y lo mismo para TODOS los clientes del archivo: ninguno se mezcla con otro.
    const porCliente = new Map<string, bigint>();
    for (const [n, f] of filas) {
      if (n === 1) continue;
      const quien = f.get("A")?.valor ?? "";
      porCliente.set(quien, (porCliente.get(quien) ?? 0n) + centavos(f.get("F")?.valor ?? "0"));
    }
    expect(porCliente.get(c.nombre)).toBe(100_000n);
  });

  it("otra empresa no ve nada de esta: el archivo trae solo sus clientes", async () => {
    const c = await cliente();
    await aCuenta(c.id);
    await cliente(otra, `Cliente ${sufijoUnico()}`);
    const { zip } = await bajar(otra);
    const cadenas = zip.get("xl/sharedStrings.xml") ?? "";
    expect(cadenas).not.toContain(c.nombre);
    expect(cadenas).not.toContain(c.cuit);
  });

  it("sin permiso (un operador): se rechaza y no deja constancia", async () => {
    const antes = (await m.auditoria(e.empresa, "CUENTA_CORRIENTE_EXPORTADA")).length;
    expect(await exportarLaCuentaCorriente(d, e.operador)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect((await m.auditoria(e.empresa, "CUENTA_CORRIENTE_EXPORTADA")).length).toBe(antes);
    expect(registrados).toEqual([]);
  });

  it("pedirlo dos veces da el mismo archivo y deja dos constancias sin los datos adentro; el libro no cambia", async () => {
    const c = await cliente();
    await aCuenta(c.id);
    const contar = () =>
      m.contar(
        "select (select count(*) from asiento_de_saldo) + (select count(*) from imputacion_de_saldo) + (select count(*) from cuenta_del_cliente) as n",
      );
    const libroAntes = await contar();
    const antes = (await m.auditoria(e.empresa, "CUENTA_CORRIENTE_EXPORTADA")).length;
    const a = await bajar();
    const b = await bajar();
    expect(b.zip.get("xl/worksheets/sheet1.xml")).toBe(a.zip.get("xl/worksheets/sheet1.xml"));
    expect(await contar()).toBe(libroAntes);
    const registros = await m.auditoria(e.empresa, "CUENTA_CORRIENTE_EXPORTADA");
    expect(registros.length - antes).toBe(2);
    const ultimo = registros.at(-1) as Record<string, unknown>;
    expect(ultimo["actor_persona_id"]).toBe(e.gerente.personaId);
    expect(JSON.stringify(ultimo["despues"])).not.toMatch(/Cliente |\d{11}|\d+\.\d{2}/);
  });

  it("exportar a la vez que se cobra nunca da un archivo a medias: el saldo del archivo es siempre uno que existió", async () => {
    const c = await cliente();
    const pendientes = [await aCuenta(c.id), await aCuenta(c.id), await aCuenta(c.id)];
    const trabajo = (async () => {
      for (const t of pendientes) await cobrar(t);
    })();
    const lecturas = (async () => {
      for (let i = 0; i < 4; i++) {
        const { filas } = await bajar();
        const suma = deUnCliente(filas, c.nombre).reduce(
          (a, f) => a + centavos(f.get("F")?.valor ?? "0"),
          0n,
        );
        // Una foto: múltiplo de los $1000 del ticket, nunca un cobro a medias.
        expect(suma % 100_000n).toBe(0n);
      }
    })();
    await Promise.all([trabajo, lecturas]);
  });
});
