import { describe, expect, it } from "vitest";
import {
  RUTA_DE_CLIENTES,
  RUTA_DE_LA_PARTE_NUEVA,
  armarLaLista,
  armarLosFiltros,
  direccionDeLaLista,
  leerLaPagina,
  leerLosFiltros,
  rutaDeLaParte,
  type FichaDeParte,
  type PaginaDePartes,
} from "../../apps/web/ui/plantillas/clientes/modelo-de-directorio";
import {
  TIPOS_DE_DOCUMENTO_OFRECIDOS,
  armarElFormularioDeParte,
  nombreDeLaFicha,
} from "../../apps/web/ui/plantillas/clientes/modelo-de-formulario-de-parte";
import { CLAVE_DE_CONDICION } from "../../apps/web/ui/plantillas/facturacion/modelo-de-emision";
import { CONDICIONES_DE_IVA } from "../../src/primitivas/identificacion-fiscal/condicion-iva";
import { PROVINCIAS } from "../../src/primitivas/domicilio/provincias";
import {
  TIPOS_DE_DOCUMENTO_DE_EMPRESA,
  TIPOS_DE_DOCUMENTO_DE_PARTE,
} from "../../src/modulos/clientes/dominio/documento";

/**
 * El modelo de vista de «Clientes y proveedores» (`modelo-de-directorio.ts` y `modelo-de-formulario-de-parte.ts`): de lo que entrega la composición, lo que se ve. Cada regla de su
 * encabezado tiene su prueba. Previene: un filtro inventado en la dirección, un tipo de documento que el servidor no admite, un campo opcional sin su «(opcional)» y un botón abierto sin permiso.
 */

const TODO_ABIERTO = { crear: true, editar: true, desactivar: true, reactivar: true };
const TODO_CERRADO = { crear: false, editar: false, desactivar: false, reactivar: false };

const pagina = (extra: Partial<PaginaDePartes> = {}): PaginaDePartes => ({
  partes: [
    {
      id: "p1",
      nombre: "Gómez, Marta",
      documento: { tipo: "DNI", pais: null, numero: "28123456" },
      roles: ["CUSTOMER"],
      activa: true,
    },
    {
      id: "p2",
      nombre: "Lácteos del Sur S.A.",
      documento: { tipo: "CUIT", pais: null, numero: "30701234563" },
      roles: ["CUSTOMER", "PROVEEDOR"],
      activa: false,
    },
    { id: "p3", nombre: "Sin papeles", documento: null, roles: [], activa: true },
  ],
  siguiente: null,
  ...extra,
});

const FICHA: FichaDeParte = {
  id: "p1",
  version: 4,
  naturaleza: "HUMANA",
  nombre: "Marta",
  apellido: "Gómez",
  alias: "La Marta",
  documento: { tipo: "DNI", pais: null, numero: "28123456" },
  condicionIva: "MONOTRIBUTO",
  email: "marta@example.com",
  telefono: "+54 11 5555 0303",
  domicilio: {
    calle: "Mitre",
    numero: "100",
    codigoPostal: "S2000",
    localidad: "Rosario",
    provincia: "AR-S",
  },
  nota: "Paga al contado",
  activa: true,
  roles: ["CUSTOMER"],
};

describe("los filtros de la dirección", () => {
  it("un rol fuera de la lista es «Todos» y desactivados solo con `on` o `1`", () => {
    expect(leerLosFiltros({ rol: "cliente" }).rol).toBe("cliente");
    expect(leerLosFiltros({ rol: "proveedor" }).rol).toBe("proveedor");
    for (const rol of ["", "CUSTOMER", "Cliente", "todos", "<script>"]) {
      expect(leerLosFiltros({ rol }).rol).toBe("");
    }
    expect(leerLosFiltros({ desactivados: "on" }).desactivados).toBe(true);
    expect(leerLosFiltros({ desactivados: "1" }).desactivados).toBe(true);
    for (const valor of ["", "0", "true", "si", "ON"]) {
      expect(leerLosFiltros({ desactivados: valor }).desactivados).toBe(false);
    }
    expect(leerLosFiltros({})).toEqual({ texto: "", rol: "", desactivados: false });
  });

  it("el texto se recorta y lo repetido en la dirección toma el primero", () => {
    expect(leerLosFiltros({ texto: "  Marta  " }).texto).toBe("Marta");
    expect(leerLosFiltros({ texto: ["uno", "dos"], rol: ["proveedor", "cliente"] })).toMatchObject({
      texto: "uno",
      rol: "proveedor",
    });
  });

  it("la página que sigue es el cursor, o nada", () => {
    expect(leerLaPagina({ despuesDe: "abc" })).toBe("abc");
    expect(leerLaPagina({ despuesDe: "" })).toBeUndefined();
    expect(leerLaPagina({})).toBeUndefined();
  });

  it("la dirección de la lista lleva solo lo que se aparta de «Todos» y la página", () => {
    expect(direccionDeLaLista({ texto: "", rol: "", desactivados: false })).toBe(RUTA_DE_CLIENTES);
    expect(direccionDeLaLista({ texto: "ana", rol: "proveedor", desactivados: true }, "c1")).toBe(
      `${RUTA_DE_CLIENTES}?texto=ana&rol=proveedor&desactivados=1&despuesDe=c1`,
    );
  });

  it("arma el formulario con los textos aprobados y los dos roles", () => {
    const f = armarLosFiltros({ texto: "x", rol: "cliente", desactivados: true });
    expect(f.accion).toBe(RUTA_DE_CLIENTES);
    expect(f.textos).toMatchObject({
      buscar: "Buscar",
      todos: "Todos",
      desactivados: "Mostrar desactivados",
      aplicar: "Aplicar filtros",
    });
    expect(f.roles).toEqual([
      { valor: "cliente", etiqueta: "Clientes" },
      { valor: "proveedor", etiqueta: "Proveedores" },
    ]);
  });
});

describe("la lista", () => {
  const filtros = { texto: "", rol: "" as const, desactivados: false };

  it("una fila por parte, con el nombre tal cual lo da la composición, enlace a la ficha, roles y marca", () => {
    const lista = armarLaLista(pagina(), filtros, TODO_ABIERTO);
    expect(lista.filas.map((f) => f.nombre)).toEqual([
      "Gómez, Marta",
      "Lácteos del Sur S.A.",
      "Sin papeles",
    ]);
    expect(lista.filas[0]).toMatchObject({
      id: "p1",
      href: rutaDeLaParte("p1"),
      roles: ["Cliente"],
      desactivado: null,
    });
    expect(lista.filas[1]).toMatchObject({
      roles: ["Cliente", "Proveedor"],
      desactivado: "Desactivado",
    });
    expect(lista.filas[2]?.roles).toEqual([]);
  });

  it("el documento lleva tipo y número con el formato de pantalla; sin documento, «—»", () => {
    const lista = armarLaLista(pagina(), filtros, TODO_ABIERTO);
    expect(lista.filas.map((f) => f.documento)).toEqual([
      "DNI 28.123.456",
      "CUIT 30-70123456-3",
      "—",
    ]);
  });

  it("un tipo sin texto aprobado muestra solo el número", () => {
    const lista = armarLaLista(
      pagina({
        partes: [
          {
            id: "p9",
            nombre: "Foreign Ltd",
            documento: { tipo: "ID_EXTRANJERO", pais: "BR", numero: "XYZ-1" },
            roles: [],
            activa: true,
          },
        ],
      }),
      filtros,
      TODO_ABIERTO,
    );
    expect(lista.filas[0]?.documento).toBe("XYZ-1");
  });

  it("sin filas, «Sin resultados»; con filas, ninguno", () => {
    expect(armarLaLista(pagina({ partes: [] }), filtros, TODO_ABIERTO).vacio).toBe(
      "Sin resultados",
    );
    expect(armarLaLista(pagina(), filtros, TODO_ABIERTO).vacio).toBeNull();
  });

  it("«Página siguiente» conserva los filtros y lleva el cursor", () => {
    const lista = armarLaLista(
      pagina({ siguiente: "c2" }),
      { texto: "ana", rol: "proveedor", desactivados: false },
      TODO_ABIERTO,
    );
    expect(lista.siguiente).toEqual({
      href: `${RUTA_DE_CLIENTES}?texto=ana&rol=proveedor&despuesDe=c2`,
      texto: "Página siguiente",
    });
    expect(armarLaLista(pagina(), filtros, TODO_ABIERTO).siguiente).toBeNull();
  });

  it("«Nuevo» solo con permiso de crear; todo lo que no es `true` cierra", () => {
    expect(armarLaLista(pagina(), filtros, TODO_ABIERTO).nuevo).toEqual({
      href: RUTA_DE_LA_PARTE_NUEVA,
      texto: "Nuevo",
    });
    expect(armarLaLista(pagina(), filtros, { ...TODO_ABIERTO, crear: false }).nuevo).toBeNull();
    expect(
      armarLaLista(pagina(), filtros, { crear: undefined } as unknown as typeof TODO_ABIERTO).nuevo,
    ).toBeNull();
  });
});

describe("el formulario", () => {
  it("los tipos de documento que se ofrecen salen del dominio: persona, todos menos «ID extranjero»; empresa, solo CUIT", () => {
    expect([...TIPOS_DE_DOCUMENTO_OFRECIDOS.HUMANA]).toEqual(
      TIPOS_DE_DOCUMENTO_DE_PARTE.filter((t) => t !== "ID_EXTRANJERO"),
    );
    expect([...TIPOS_DE_DOCUMENTO_OFRECIDOS.JURIDICA]).toEqual(
      TIPOS_DE_DOCUMENTO_DE_EMPRESA.filter((t) => t !== "ID_EXTRANJERO"),
    );
    const f = armarElFormularioDeParte(null, TODO_ABIERTO);
    expect(f.documentoTipo.opciones.HUMANA.map((o) => o.etiqueta)).toEqual([
      "CUIT",
      "CUIL",
      "CDI",
      "DNI",
      "Pasaporte",
    ]);
    expect(f.documentoTipo.opciones.JURIDICA.map((o) => o.valor)).toEqual(["CUIT"]);
  });

  it("las condiciones de IVA son las del dominio, en su orden, con los textos de «Emitir»", () => {
    const f = armarElFormularioDeParte(null, TODO_ABIERTO);
    expect(f.condicionIva.opciones.map((o) => o.valor)).toEqual([...CONDICIONES_DE_IVA]);
    expect(f.condicionIva.opciones).toHaveLength(11);
    expect(Object.keys(CLAVE_DE_CONDICION)).toEqual([...CONDICIONES_DE_IVA]);
  });

  it("las provincias son las 24 del dominio y viaja el código", () => {
    const f = armarElFormularioDeParte(null, TODO_ABIERTO);
    expect(f.provincia.opciones).toHaveLength(PROVINCIAS.length);
    expect(f.provincia.opciones[0]).toEqual({
      valor: PROVINCIAS[0]?.codigo,
      etiqueta: PROVINCIAS[0]?.nombre,
    });
  });

  it("«(opcional)» lo llevan estos campos y no los demás, como la maqueta", () => {
    const f = armarElFormularioDeParte(null, TODO_ABIERTO);
    const conOpcional = [
      f.apellido,
      f.alias,
      f.documentoNumero,
      f.condicionIva,
      f.email,
      f.telefono,
      f.calle,
      f.numero,
      f.codigoPostal,
      f.localidad,
      f.provincia,
      f.nota,
    ];
    for (const campo of conOpcional) expect(campo.etiqueta).toMatch(/ \(opcional\)$/);
    expect(conOpcional.map((c) => c.etiqueta)).toEqual([
      "Apellido (opcional)",
      "Alias (opcional)",
      "Número (opcional)",
      "Condición frente al IVA (opcional)",
      "Email (opcional)",
      "Teléfono (opcional)",
      "Calle (opcional)",
      "Número (opcional)",
      "Código postal (opcional)",
      "Localidad (opcional)",
      "Provincia (opcional)",
      "Nota (opcional)",
    ]);
    const sin = [
      f.naturaleza.etiqueta,
      f.nombre.etiquetaDePersona,
      f.nombre.etiquetaDeEmpresa,
      f.documentoTipo.etiqueta,
      f.documentoPais.etiqueta,
    ];
    for (const etiqueta of sin) expect(etiqueta).not.toMatch(/opcional/);
    expect(sin).toEqual([
      "Persona / Empresa",
      "Nombre",
      "Razón social",
      "Tipo de documento",
      "País",
    ]);
  });

  it("el alta nace en blanco, como persona con tipo CUIT, y «Nuevo» es el título", () => {
    const f = armarElFormularioDeParte(null, TODO_ABIERTO);
    expect(f.titulo).toBe("Nuevo");
    expect(f.naturaleza.valorInicial).toBe("HUMANA");
    expect(f.documentoTipo).toMatchObject({ valorInicial: "CUIT", conOpcionVacia: false });
    expect(f.nombre.valorInicial).toBe("");
    expect(f.roles.cliente.valorInicial).toBe(false);
    expect(f.roles.proveedor.valorInicial).toBe(false);
    expect(f.estado).toBeNull();
  });

  it("el rol de la dirección tilda la casilla de ese rol en el alta (y ninguna sin rol)", () => {
    expect(armarElFormularioDeParte(null, TODO_ABIERTO, "proveedor").roles).toMatchObject({
      cliente: { valorInicial: false },
      proveedor: { valorInicial: true },
    });
    expect(armarElFormularioDeParte(null, TODO_ABIERTO, "cliente").roles).toMatchObject({
      cliente: { valorInicial: true },
      proveedor: { valorInicial: false },
    });
  });

  it("la ficha trae sus datos, sus roles y «Desactivar»; el título es «Apellido, Nombre»", () => {
    const f = armarElFormularioDeParte(FICHA, TODO_ABIERTO, "proveedor");
    expect(f.titulo).toBe("Gómez, Marta");
    expect(f.nombre.valorInicial).toBe("Marta");
    expect(f.apellido.valorInicial).toBe("Gómez");
    expect(f.documentoTipo.valorInicial).toBe("DNI");
    expect(f.documentoNumero.valorInicial).toBe("28123456");
    expect(f.condicionIva.valorInicial).toBe("MONOTRIBUTO");
    expect(f.provincia.valorInicial).toBe("AR-S");
    expect(f.roles.cliente.valorInicial).toBe(true);
    // El rol de la dirección solo vale para el alta: la ficha dice lo que la parte es.
    expect(f.roles.proveedor.valorInicial).toBe(false);
    expect(f.estado).toEqual({ texto: "Desactivar", reactivar: false, apagado: false });
  });

  it("una desactivada ofrece «Reactivar»", () => {
    expect(armarElFormularioDeParte({ ...FICHA, activa: false }, TODO_ABIERTO).estado).toEqual({
      texto: "Reactivar",
      reactivar: true,
      apagado: false,
    });
  });

  it("el título de una empresa es su nombre y el de una persona sin apellido, su nombre", () => {
    expect(
      nombreDeLaFicha({ ...FICHA, naturaleza: "JURIDICA", nombre: "Hotel Centro S.R.L." }),
    ).toBe("Hotel Centro S.R.L.");
    expect(nombreDeLaFicha({ ...FICHA, apellido: null })).toBe("Marta");
  });

  it("un tipo guardado que no se ofrece (ID extranjero) sale con la opción vacía y no se cambia en silencio", () => {
    const f = armarElFormularioDeParte(
      { ...FICHA, documento: { tipo: "ID_EXTRANJERO", pais: "BR", numero: "XYZ-1" } },
      TODO_ABIERTO,
    );
    expect(f.documentoTipo).toMatchObject({ valorInicial: "", conOpcionVacia: true });
    expect(f.textos.sinElegir).toBe("Sin elegir");
  });

  it("cada permiso apaga lo suyo por separado", () => {
    expect(armarElFormularioDeParte(null, { ...TODO_ABIERTO, crear: false }).puedeGuardar).toBe(
      false,
    );
    expect(armarElFormularioDeParte(null, { ...TODO_ABIERTO, editar: false }).puedeGuardar).toBe(
      true,
    );
    expect(armarElFormularioDeParte(FICHA, { ...TODO_ABIERTO, editar: false }).puedeGuardar).toBe(
      false,
    );
    expect(armarElFormularioDeParte(FICHA, { ...TODO_ABIERTO, crear: false }).puedeGuardar).toBe(
      true,
    );
    expect(
      armarElFormularioDeParte(FICHA, { ...TODO_ABIERTO, desactivar: false }).estado?.apagado,
    ).toBe(true);
    expect(
      armarElFormularioDeParte(FICHA, { ...TODO_ABIERTO, reactivar: false }).estado?.apagado,
    ).toBe(false);
    const inactiva = { ...FICHA, activa: false };
    expect(
      armarElFormularioDeParte(inactiva, { ...TODO_ABIERTO, reactivar: false }).estado?.apagado,
    ).toBe(true);
    expect(
      armarElFormularioDeParte(inactiva, { ...TODO_ABIERTO, desactivar: false }).estado?.apagado,
    ).toBe(false);
  });

  it("con todos los permisos en falso, todo cerrado", () => {
    const alta = armarElFormularioDeParte(null, TODO_CERRADO);
    expect(alta.puedeGuardar).toBe(false);
    const ficha = armarElFormularioDeParte(FICHA, TODO_CERRADO);
    expect(ficha.puedeGuardar).toBe(false);
    expect(ficha.estado?.apagado).toBe(true);
    expect(
      armarLaLista(pagina(), { texto: "", rol: "", desactivados: false }, TODO_CERRADO).nuevo,
    ).toBeNull();
  });
});
