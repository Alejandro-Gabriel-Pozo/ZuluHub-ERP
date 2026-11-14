import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { BaseDePruebas } from "./global";
import { montarCatalogo, valorDe, cotizarEnTx } from "./catalogo-apoyo";
import { codigoAlAzar, comoPublico } from "./carta-publica-apoyo";
import {
  AHORA_DE_LA_VISITA,
  MARCA_DEL_HOST,
  OTRA_MARCA,
  adaptadorReal,
  montarEnsayo,
  precioDeBase,
  type Catalogo,
  type Ensayo,
} from "./carta-publica-lectura-apoyo";
import type { VidrieraPublicada } from "../../src/puertos/vidriera-publica";

/**
 * T3 contra una base real y el rol `pedernal_publico` VERDADERO: qué sale (y qué no), el orden, la respuesta única «no disponible», el cierre sin código y la
 * PARIDAD con la caja (lo que ve el comensal es lo que cotiza la caja, con valores exactos).
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe.skipIf(base === null)("lectura pública de la carta (0044) con el rol real", () => {
  let c: Catalogo;
  let en: Ensayo;
  let vidriera: ReturnType<typeof adaptadorReal>["vidriera"];
  let publicas: ReturnType<typeof adaptadorReal>["publicas"];
  let carta: VidrieraPublicada;
  beforeAll(async () => {
    c = await montarCatalogo(base as BaseDePruebas);
    en = await montarEnsayo(c);
    ({ vidriera, publicas } = adaptadorReal(c));
    carta = (await vidriera.porCodigo(MARCA_DEL_HOST, en.carta1.codigo)) as VidrieraPublicada;
  });
  afterAll(async () => {
    await publicas.cerrar();
    await c.cerrar();
  });

  /** Aritmética exacta a 6 decimales: el texto decimal a enteros de millonésimos. */
  const micro = (t: string): bigint => {
    const [e, f = ""] = t.split(".");
    return BigInt(e as string) * 1_000_000n + BigInt(f.padEnd(6, "0").slice(0, 6));
  };
  const productosDe = (v: VidrieraPublicada) =>
    v.secciones.map((s) => s.productos.map((p) => p.nombre));

  it("L-1: sale lo que corresponde, con las secciones en su orden y los productos por nombre", () => {
    expect(carta.secciones.map((s) => s.nombre)).toEqual([
      "Entradas",
      "Platos",
      "Postres",
      "Cafetería",
    ]);
    // Sin sección (Sopa), inactivo (Tarta), sin precio (Helado) y la sección inactiva (Budín) no salen.
    expect(productosDe(carta)).toEqual([
      ["Empanada de carne"],
      ["Milanesa napolitana"],
      ["Flan"],
      ["Café"],
    ]);
    expect(carta.nombre).toBe("Parador El Ensayo");
    expect(carta.letraBase).toBe("NORMAL");
  });

  it("L-2: rubro y lugar nulos viajan como null; el mensaje de portada viaja sin filtrar", async () => {
    expect(carta.rubro).toBeNull();
    expect(carta.lugar).toBeNull();
    expect(carta.mensajeDePortada).toBeNull();
    const r = await c.dueno.query<{ id: string }>(
      "select id from carta_publica where codigo = $1",
      [en.carta2.codigo],
    );
    await c.dueno.query(
      "update carta_publica set rubro = 'Cafetería', lugar = 'Av. Belgrano 412', mensaje_de_portada = 'Hoy: ¡2x1 en flan!' where id = $1",
      [r.rows[0]?.id],
    );
    const otra = (await vidriera.porCodigo(MARCA_DEL_HOST, en.carta2.codigo)) as VidrieraPublicada;
    expect([otra.rubro, otra.lugar, otra.mensajeDePortada]).toEqual([
      "Cafetería",
      "Av. Belgrano 412",
      "Hoy: ¡2x1 en flan!",
    ]);
  });

  it("L-3: descripción y precios exactos del ensayo", () => {
    const [empanada] = carta.secciones[0]?.productos ?? [];
    expect(empanada?.descripcion).toBe("Frita o al horno");
    expect(micro(empanada?.precioBase ?? "")).toBe(micro("1500"));
  });

  it("L-4: los grupos «que se muestran en la carta» salen; el que no se muestra, no", () => {
    const milanesa = carta.secciones[1]?.productos[0];
    const titulos = [...(milanesa?.obligatorios ?? []), ...(milanesa?.adicionales ?? [])].map(
      (g) => g.titulo,
    );
    expect(milanesa?.obligatorios.map((g) => g.opciones.map((o) => o.nombre))).toEqual([
      ["Puré", "Ensalada", "Papas fritas"],
    ]);
    expect(titulos).toContain("Guarnición");
    expect(titulos).toContain("Extras");
    expect(titulos).not.toContain("Proteína");
  });

  it("A-1: misma respuesta (null) para código inventado, de otra marca, malformado y carta retirada", async () => {
    expect(await vidriera.porCodigo(MARCA_DEL_HOST, codigoAlAzar())).toBeNull();
    expect(await vidriera.porCodigo(OTRA_MARCA, en.carta1.codigo)).toBeNull();
    expect(await vidriera.porCodigo(MARCA_DEL_HOST, "no-es-un-codigo")).toBeNull();
    await c.dueno.query("update carta_publica set estado = 'FUERA_DE_LINEA' where id = $1", [
      en.carta2.id,
    ]);
    expect(await vidriera.porCodigo(MARCA_DEL_HOST, en.carta2.codigo)).toBeNull();
    await c.dueno.query("update carta_publica set estado = 'EN_LINEA' where id = $1", [
      en.carta2.id,
    ]);
  });

  it("A-2: sucursal inactiva = misma respuesta que un código inventado", async () => {
    await c.dueno.query("update sucursal set activa = false where id = $1", [en.e.otraSucursal]);
    expect(await vidriera.porCodigo(MARCA_DEL_HOST, en.carta2.codigo)).toBeNull();
    await c.dueno.query("update sucursal set activa = true where id = $1", [en.e.otraSucursal]);
    expect(await vidriera.porCodigo(MARCA_DEL_HOST, en.carta2.codigo)).not.toBeNull();
  });

  it("A-3: ocultar un producto lo saca de la carta de esa sucursal y no de la otra", async () => {
    await c.dueno.query(
      `insert into disponibilidad_de_producto (empresa_id, producto_id, sucursal_id, oculto, actualizado_en) values ($1, $2, $3, true, now())`,
      [en.e.empresa, en.p.flan, en.e.sucursal],
    );
    const a = (await vidriera.porCodigo(MARCA_DEL_HOST, en.carta1.codigo)) as VidrieraPublicada;
    const b = (await vidriera.porCodigo(MARCA_DEL_HOST, en.carta2.codigo)) as VidrieraPublicada;
    expect(productosDe(a).flat()).not.toContain("Flan");
    expect(productosDe(b).flat()).toContain("Flan");
  });

  describe("el rol público real", () => {
    const publico = () => c.propia.base.publico;
    const tablas = [
      "empresa",
      "tenant",
      "sucursal",
      "seccion_de_carta",
      "producto",
      "grupo_de_elecciones",
      "opcion",
      "version_de_opcion",
      "precio_de_venta",
    ];
    it("C-1: sin código fijado ninguna tabla devuelve filas", async () => {
      for (const t of tablas) {
        const filas = await comoPublico<{ n: string }>(
          publico(),
          null,
          `select count(*)::text as n from ${t}`,
        );
        expect(filas[0]?.n, t).toBe("0");
      }
    });
    it("C-2: con un código inventado ninguna tabla devuelve filas", async () => {
      for (const t of tablas) {
        const filas = await comoPublico<{ n: string }>(
          publico(),
          codigoAlAzar(),
          `select count(*)::text as n from ${t}`,
        );
        expect(filas[0]?.n, t).toBe("0");
      }
    });
    it("C-3: con un código real solo se ve la empresa de ese código", async () => {
      const filas = await comoPublico<{ n: string }>(
        publico(),
        en.carta1.codigo,
        "select count(*)::text as n from empresa",
      );
      expect(filas[0]?.n).toBe("1");
    });
    it("C-4: no puede leer columnas fuera de la enumeración (p. ej. producto.costo, empresa.razon_social)", async () => {
      await expect(
        comoPublico(publico(), en.carta1.codigo, "select razon_social from empresa"),
      ).rejects.toMatchObject({ code: "42501" });
    });
    it("C-6: lo que el rol público puede leer es EXACTAMENTE esto (columna por columna); cualquier ampliación falla", async () => {
      const filas = await c.dueno.query<{ tabla: string; columnas: string }>(
        `select table_name as tabla, string_agg(column_name, ',' order by column_name) as columnas
           from information_schema.column_privileges
          where grantee = 'pedernal_publico' and privilege_type = 'SELECT' and table_schema = 'public'
          group by table_name order by table_name`,
      );
      const otorgado = Object.fromEntries(filas.rows.map((f) => [f.tabla, f.columnas.split(",")]));
      const ordenadas = (...columnas: string[]) => [...columnas].sort();
      expect(otorgado).toEqual({
        // La puerta de marcas (resolución de host y aspecto): no es la carta.
        dominio: ordenadas(
          "duenio_empresa_id",
          "duenio_marca_id",
          "es_canonico",
          "estado",
          "host",
          "marca_id",
          "superficie",
        ),
        marca: ordenadas("codigo", "es_principal", "id", "marca_padre_id", "nivel"),
        resolucion_de_host: ordenadas(
          "duenio_empresa_id",
          "duenio_marca_id",
          "host",
          "marca_id",
          "superficie",
        ),
        version_de_marca: ordenadas(
          "aspecto",
          "logo",
          "marca_id",
          "nombre_visible",
          "numero",
          "tema",
          "vigente_desde",
          "vocabulario",
        ),
        // La carta (0043 y 0044).
        carta_publica: ordenadas(
          "codigo",
          "empresa_id",
          "estado",
          "id",
          "lugar",
          "mensaje_de_portada",
          "nombre",
          "rubro",
          "sucursal_id",
        ),
        disponibilidad_de_producto: ordenadas("empresa_id", "oculto", "producto_id", "sucursal_id"),
        empresa: ordenadas("estado", "id", "tenant_id"),
        tenant: ordenadas("estado", "id", "marca_id"),
        sucursal: ordenadas("activa", "empresa_id", "id"),
        seccion_de_carta: ordenadas("activa", "empresa_id", "id", "nombre", "orden"),
        producto: ordenadas(
          "activo",
          "clase_de_uso",
          "descripcion_en_carta",
          "empresa_id",
          "id",
          "nombre",
          "nombre_clave",
          "seccion_de_carta_id",
        ),
        grupo_de_elecciones: ordenadas(
          "activo",
          "clase",
          "empresa_id",
          "es_obligatorio",
          "id",
          "nombre",
          "orden",
          "producto_id",
          "se_muestra_en_carta",
        ),
        opcion: ordenadas("activa", "empresa_id", "grupo_id", "id", "orden"),
        version_de_opcion: ordenadas("empresa_id", "nombre", "numero", "opcion_id", "recargo"),
        // El plan de la empresa de la carta (0050, T6; decisión del dueño del 13/11/2026): módulos, asignaciones, versiones (solo módulos y perillas, sin nombre
        // comercial) y ajustes (sin motivo ni autor). Si esto cambia, que sea a propósito.
        modulo_de_empresa: ordenadas("activo", "empresa_id", "modulo"),
        plan_de_tenant: ordenadas("numero", "tenant_id", "version_de_plan_id", "vigente_desde"),
        version_de_plan: ordenadas("id", "modulos", "numero", "perillas", "plan_id"),
        ajuste_de_perilla: ordenadas(
          "empresa_id",
          "numero",
          "perilla",
          "tenant_id",
          "valor",
          "vigente_desde",
        ),
        // DECISIÓN ACEPTADA (DEC-0341): las 13 columnas, incluida `cargado_por`, porque `precio_vigente` lee la fila entera. Si esto cambia, que sea a propósito.
        precio_de_venta: ordenadas(
          "cargado_por",
          "creado_en",
          "empresa_id",
          "id",
          "iva_incluido",
          "moneda",
          "opcion_id",
          "paso_minimo",
          "precio",
          "producto_id",
          "sucursal_id",
          "unidad_id",
          "vigente_desde",
        ),
      });
    });
    it("C-5: no puede escribir", async () => {
      await expect(
        comoPublico(publico(), en.carta1.codigo, "update producto set activo = false"),
      ).rejects.toMatchObject({ code: "25006" });
    });
  });

  describe("paridad con la caja", () => {
    const enCaja = async (producto: string, opciones: string[]) => {
      const cotizado = valorDe(
        await cotizarEnTx(c, en.e.gerente, {
          sucursalId: en.e.sucursal,
          productoId: producto,
          opcionIds: opciones,
          ahora: AHORA_DE_LA_VISITA,
        }),
      );
      if (cotizado.precioUnitario === null) throw new Error("la caja no cotizó un precio");
      return micro(cotizado.precioUnitario);
    };

    it("P-1: producto simple: la carta muestra lo que cotiza la caja", async () => {
      const p = carta.secciones[0]?.productos[0];
      expect(micro(p?.precioBase ?? "0")).toBe(await enCaja(en.p.empanada, []));
    });
    it("P-2: café: precio por tamaño = caja con ese tamaño", async () => {
      const cafe = carta.secciones[3]?.productos[0];
      expect(cafe?.tamanos.map((t) => t.nombre)).toEqual(["Chico", "Mediano", "Grande"]);
      // Con tamaños el precio base es 0 y cada tamaño trae su precio final como recargo: base + recargo = lo que cotiza la caja.
      const desdeCarta = cafe?.tamanos.map((t) => micro(cafe.precioBase) + micro(t.recargo));
      expect(desdeCarta).toEqual([micro("2000"), micro("2500"), micro("3000")]);
      for (const [id, esperado] of [
        [en.o.chico, "2000"],
        [en.o.mediano, "2500"],
        [en.o.grande, "3000"],
      ] as const) {
        expect(await enCaja(en.p.cafe, [id])).toBe(micro(esperado));
      }
    });
    it("P-3: milanesa con cada adicional y guarnición: base + recargo de la carta = caja", async () => {
      const m = carta.secciones[1]?.productos[0];
      const base0 = micro(m?.precioBase ?? "0");
      for (const guar of [en.o.pure, en.o.ensalada, en.o.papas]) {
        expect(await enCaja(en.p.milanesa, [guar])).toBe(base0);
        expect(await enCaja(en.p.milanesa, [guar, en.o.huevo])).toBe(base0 + micro("400"));
      }
    });
    it("P-4: un precio vigente futuro no sale hoy; uno de sucursal pisa al de la empresa", async () => {
      await precioDeBase(c.dueno, {
        empresa: en.e.empresa,
        producto: en.p.empanada,
        precio: "1800",
        sucursal: en.e.sucursal,
        desde: "2026-10-15T00:00:00Z",
      });
      await precioDeBase(c.dueno, {
        empresa: en.e.empresa,
        producto: en.p.empanada,
        precio: "9999",
        desde: "2027-01-01T00:00:00Z",
      });
      const a = (await vidriera.porCodigo(MARCA_DEL_HOST, en.carta1.codigo)) as VidrieraPublicada;
      const b = (await vidriera.porCodigo(MARCA_DEL_HOST, en.carta2.codigo)) as VidrieraPublicada;
      expect(micro(a.secciones[0]?.productos[0]?.precioBase ?? "0")).toBe(micro("1800"));
      expect(micro(b.secciones[0]?.productos[0]?.precioBase ?? "0")).toBe(micro("1500"));
      expect(micro(a.secciones[0]?.productos[0]?.precioBase ?? "0")).toBe(
        await enCaja(en.p.empanada, []),
      );
    });
  });

  it("L-9: un fallo de la base no se disfraza de «no disponible»", async () => {
    const roto = adaptadorReal({
      ...c,
      propia: {
        ...c.propia,
        base: { ...c.propia.base, publico: "postgres://nadie:nada@127.0.0.1:1/x" },
      },
    });
    await expect(roto.vidriera.porCodigo(MARCA_DEL_HOST, en.carta1.codigo)).rejects.toThrow();
    await roto.publicas.cerrar();
  });
});
