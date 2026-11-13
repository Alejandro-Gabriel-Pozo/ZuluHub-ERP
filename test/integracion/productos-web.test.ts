import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  listarLosProductos,
  type DependenciasDeProductosWeb,
  type ProductosParaLaPantalla,
} from "../../src/composicion/productos-web";
import type { EntradaDeLaLista } from "../../src/composicion/entradas-de-productos";
import { personaId } from "../../src/primitivas/identificadores/marca";
import {
  grupoDeBase,
  montarCatalogo,
  precioDeBase,
  productoDeBase,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";
import { comoEmpresa } from "./entorno";

/**
 * La lista de productos de la web (`productos-web.ts`, A1 T1) contra una base real y los roles reales: lo que la pantalla recibe (solo id, nombre, clase, estado y precio, con el
 * importe como texto), cada filtro, la paginación por nombre, que una empresa no ve los productos de otra, que el permiso y el módulo en desarrollo los decide la consulta y que un
 * fallo inesperado sale sin detalle. Las consultas del catálogo en sí (guard, filtros, páginas) tienen su prueba en `catalogo-casos-de-uso.test.ts`.
 * Concurrencia, idempotencia y auditoría NO aplican: es una lectura (aquí se comprueba que no escribe nada).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const SIN_FILTROS: EntradaDeLaLista = { texto: "", clase: "", estado: "", despues: "" };
const con = (cambios: Partial<EntradaDeLaLista>): EntradaDeLaLista => ({
  ...SIN_FILTROS,
  ...cambios,
});

describe.skipIf(base === null)("lista de productos de la web", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let cerrado: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let registrados: string[];
  let d: DependenciasDeProductosWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    // El catálogo real: `catalogo` sigue `en_desarrollo` y el guard rechaza todo.
    cerrado = await montarCatalogo(base, {
      reglas: { catalogo: CATALOGO_DE_MODULOS, permisos: PERMISOS_DE_EMPRESA },
    });
    e = await c.escenario();
    registrados = [];
    d = {
      consultas: () => c.consultas,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    if (base === null) return;
    await c.cerrar();
    await cerrado.cerrar();
  });

  const lista = async (
    entrada: EntradaDeLaLista,
    contexto = e.gerente,
  ): Promise<ProductosParaLaPantalla> => {
    const r = await listarLosProductos(d, contexto, entrada);
    if (!r.ok) throw new Error(`se esperaba la lista y vino ${r.error.codigo}`);
    return r.dato;
  };
  const nombres = async (entrada: EntradaDeLaLista, contexto = e.gerente) =>
    (await lista(entrada, contexto)).productos.map((p) => p.nombre);

  it("la lista trae los productos de la empresa, también los desactivados, con solo id, nombre, clase, estado y precio", async () => {
    const x = await c.escenario();
    const conPrecio = await productoDeBase(c.dueno, x.empresa, { nombre: "Alfajor" });
    await precioDeBase(c.dueno, {
      empresa: x.empresa,
      producto: conPrecio,
      precio: "1500",
      desde: "2026-01-01T00:00:00Z",
    });
    await productoDeBase(c.dueno, x.empresa, { nombre: "Bizcocho" });
    const conMedidas = await productoDeBase(c.dueno, x.empresa, { nombre: "Café" });
    await grupoDeBase(c.dueno, x.empresa, conMedidas, { clase: "VARIANTE", esTamano: true });
    await productoDeBase(c.dueno, x.empresa, {
      nombre: "Dulce",
      clase: "INSUMO",
      faltaCompletar: true,
    });
    await productoDeBase(c.dueno, x.empresa, { nombre: "Empanada", activo: false });
    const pagina = await lista(SIN_FILTROS, x.gerente);
    expect(pagina.productos.map((p) => [p.nombre, p.claseDeUso, p.estado, p.precio])).toEqual([
      ["Alfajor", "VENDIBLE", "ACTIVO", { tipo: "EMPRESA", importe: "1500.000000" }],
      ["Bizcocho", "VENDIBLE", "ACTIVO", { tipo: "SIN_PRECIO" }],
      ["Café", "VENDIBLE", "ACTIVO", { tipo: "SEGUN_TAMANO" }],
      ["Dulce", "INSUMO", "FALTA_COMPLETAR", null],
      ["Empanada", "VENDIBLE", "DESACTIVADO", { tipo: "SIN_PRECIO" }],
    ]);
    expect(pagina.siguiente).toBeNull();
    for (const p of pagina.productos) {
      expect(Object.keys(p).sort()).toEqual(["claseDeUso", "estado", "id", "nombre", "precio"]);
    }
  });

  it("el importe sale como texto decimal, nunca como número (ADR-006)", async () => {
    const x = await c.escenario();
    const id = await productoDeBase(c.dueno, x.empresa, { nombre: "Parrillada" });
    await precioDeBase(c.dueno, {
      empresa: x.empresa,
      producto: id,
      precio: "1234567.123456",
      desde: "2026-01-01T00:00:00Z",
    });
    const [producto] = (await lista(SIN_FILTROS, x.gerente)).productos;
    expect(producto?.precio).toEqual({ tipo: "EMPRESA", importe: "1234567.123456" });
    expect(typeof (producto?.precio as { importe: unknown }).importe).toBe("string");
  });

  it("buscar por texto: prefijo del nombre sin distinguir mayúsculas; clase y estado se combinan", async () => {
    const x = await c.escenario();
    await productoDeBase(c.dueno, x.empresa, { nombre: "Pizza muzzarella" });
    await productoDeBase(c.dueno, x.empresa, { nombre: "Pizza especial", activo: false });
    await productoDeBase(c.dueno, x.empresa, { nombre: "Pan lactal", clase: "REVENTA" });
    await productoDeBase(c.dueno, x.empresa, {
      nombre: "Pan rallado",
      clase: "INSUMO",
      faltaCompletar: true,
    });
    await productoDeBase(c.dueno, x.empresa, { nombre: "Harina", clase: "MATERIA_PRIMA" });
    expect(await nombres(con({ texto: "PIZ" }), x.gerente)).toEqual([
      "Pizza especial",
      "Pizza muzzarella",
    ]);
    expect(await nombres(con({ texto: "pan" }), x.gerente)).toEqual(["Pan lactal", "Pan rallado"]);
    expect(await nombres(con({ clase: "INSUMO" }), x.gerente)).toEqual(["Pan rallado"]);
    expect(await nombres(con({ clase: "MATERIA_PRIMA" }), x.gerente)).toEqual(["Harina"]);
    expect(await nombres(con({ estado: "DESACTIVADO" }), x.gerente)).toEqual(["Pizza especial"]);
    expect(await nombres(con({ estado: "FALTA_COMPLETAR" }), x.gerente)).toEqual(["Pan rallado"]);
    expect(await nombres(con({ estado: "ACTIVO" }), x.gerente)).toEqual([
      "Harina",
      "Pan lactal",
      "Pizza muzzarella",
    ]);
    expect(
      await nombres(con({ texto: "pan", clase: "REVENTA", estado: "ACTIVO" }), x.gerente),
    ).toEqual(["Pan lactal"]);
    expect(await nombres(con({ texto: "pizza", clase: "INSUMO" }), x.gerente)).toEqual([]);
  });

  it("un desactivado que además falta completar es «Desactivado»: sale en ese filtro y no en «Falta completar»", async () => {
    const x = await c.escenario();
    await productoDeBase(c.dueno, x.empresa, {
      nombre: "Doble",
      clase: "INSUMO",
      activo: false,
      faltaCompletar: true,
    });
    expect(
      (await lista(con({ estado: "DESACTIVADO" }), x.gerente)).productos.map((p) => p.estado),
    ).toEqual(["DESACTIVADO"]);
    expect(await nombres(con({ estado: "FALTA_COMPLETAR" }), x.gerente)).toEqual([]);
    expect(await nombres(con({ estado: "ACTIVO" }), x.gerente)).toEqual([]);
  });

  it("lo que no puede coincidir (texto con caracteres no permitidos o muy largo, clase o estado inventados, página falsa) da una lista vacía, nunca todo", async () => {
    const x = await c.escenario();
    await productoDeBase(c.dueno, x.empresa, { nombre: "Pizza" });
    for (const entrada of [
      con({ texto: "piz<" }),
      con({ texto: "a".repeat(500) }),
      con({ clase: "SERVICIO" }),
      con({ estado: "BORRADO" }),
      con({ despues: "no es una página" }),
      con({ despues: `${randomUUID()}:` }),
    ]) {
      expect(await lista(entrada, x.gerente)).toEqual({ productos: [], siguiente: null });
    }
    expect(await nombres(SIN_FILTROS, x.gerente)).toEqual(["Pizza"]);
  });

  it("pagina de a 50 por nombre: la segunda página sigue a la primera, sin repetir ni perder, y conserva los filtros", async () => {
    const x = await c.escenario();
    const esperados: string[] = [];
    for (let i = 0; i < 52; i += 1) {
      const nombre = `Pan ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i / 26) | 0))}`;
      esperados.push(nombre);
      await productoDeBase(c.dueno, x.empresa, { nombre });
    }
    await productoDeBase(c.dueno, x.empresa, { nombre: "Queso" });
    esperados.sort();
    const primera = await lista(con({ texto: "pan" }), x.gerente);
    expect(primera.productos).toHaveLength(50);
    expect(primera.siguiente).toMatch(/^[0-9a-f-]{36}:pan /);
    const segunda = await lista(
      con({ texto: "pan", despues: primera.siguiente as string }),
      x.gerente,
    );
    expect(segunda.productos).toHaveLength(2);
    expect(segunda.siguiente).toBeNull();
    expect([...primera.productos, ...segunda.productos].map((p) => p.nombre)).toEqual(esperados);
    // Con otro filtro, la misma clave no cuela lo que el filtro excluye.
    expect(
      await nombres(
        con({ texto: "pan", clase: "INSUMO", despues: primera.siguiente as string }),
        x.gerente,
      ),
    ).toEqual([]);
  });

  it("aislamiento: una empresa no ve los productos de otra, ni por texto, ni por clave de página, ni con el mismo nombre", async () => {
    const a = await c.escenario();
    const b = await c.escenario();
    await productoDeBase(c.dueno, a.empresa, { nombre: "Solo de A" });
    await productoDeBase(c.dueno, b.empresa, { nombre: "Solo de B" });
    await productoDeBase(c.dueno, b.empresa, { nombre: "Repetido" });
    await productoDeBase(c.dueno, a.empresa, { nombre: "Repetido" });
    expect(await nombres(SIN_FILTROS, a.gerente)).toEqual(["Repetido", "Solo de A"]);
    expect(await nombres(con({ texto: "solo de b" }), a.gerente)).toEqual([]);
    expect(await nombres(SIN_FILTROS, b.gerente)).toEqual(["Repetido", "Solo de B"]);
    // La clave de página con un id de B, usada desde A, solo ordena: no trae nada de B.
    const deB = await lista(con({ texto: "so" }), b.gerente);
    expect(deB.productos).toHaveLength(1);
    expect(await nombres(con({ despues: `${deB.productos[0]?.id}:a` }), a.gerente)).toEqual([
      "Repetido",
      "Solo de A",
    ]);
  });

  it("el permiso lo decide la consulta: gerente, administrador y operador ven la lista", async () => {
    const x = await c.escenario();
    await productoDeBase(c.dueno, x.empresa, { nombre: "Visible" });
    for (const contexto of [x.gerente, x.administrador, x.operador]) {
      expect(await nombres(SIN_FILTROS, contexto)).toEqual(["Visible"]);
    }
  });

  it("una persona que no es de la empresa recibe el motivo del guard (el módulo no está activo para ella) y ningún dato", async () => {
    const x = await c.escenario();
    await productoDeBase(c.dueno, x.empresa, { nombre: "Reservado" });
    const ajena = comoEmpresa(x.empresaId, personaId(randomUUID()));
    const r = await listarLosProductos(d, ajena, SIN_FILTROS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe("MODULO_NO_ACTIVO");
    expect(JSON.stringify(r)).not.toContain("Reservado");
  });

  it("con el catálogo en desarrollo (hoy, en el catálogo real) todos reciben MODULO_EN_DESARROLLO y ningún dato", async () => {
    const x = await cerrado.escenario();
    await productoDeBase(cerrado.dueno, x.empresa, { nombre: "Cerrado" });
    const dependencias: DependenciasDeProductosWeb = { ...d, consultas: () => cerrado.consultas };
    for (const contexto of [x.gerente, x.administrador, x.operador]) {
      const r = await listarLosProductos(dependencias, contexto, SIN_FILTROS);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error.codigo).toBe("MODULO_EN_DESARROLLO");
      expect(r.error.presentacion).toBe("POR_QUE_NO_PUEDO");
      expect(JSON.stringify(r)).not.toContain("Cerrado");
    }
  });

  it("es una lectura: no escribe ni audita", async () => {
    const x = await c.escenario();
    await productoDeBase(c.dueno, x.empresa, { nombre: "Intacto" });
    const antes = await c.contar(
      "select count(*) as n from auditoria_empresa where empresa_id = $1",
      [x.empresa],
    );
    const versionAntes = await c.filas("select version from producto where empresa_id = $1", [
      x.empresa,
    ]);
    await lista(con({ texto: "int" }), x.gerente);
    await lista(SIN_FILTROS, x.operador);
    expect(
      await c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        x.empresa,
      ]),
    ).toBe(antes);
    expect(
      await c.filas("select version from producto where empresa_id = $1", [x.empresa]),
    ).toEqual(versionAntes);
  });

  it("un fallo inesperado sale sin detalle y con referencia; el detalle va al registro del servidor", async () => {
    const x = await c.escenario();
    const roto: DependenciasDeProductosWeb = {
      ...d,
      consultas: () => {
        throw new Error("la base dijo: relation producto_x does not exist");
      },
    };
    const r = await listarLosProductos(roto, x.gerente, SIN_FILTROS);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(r.error)).not.toContain("relation");
    expect(r.error.referencia).toMatch(/^PD-/);
    expect(registrados.some((z) => z.includes("relation producto_x"))).toBe(true);
  });
});
