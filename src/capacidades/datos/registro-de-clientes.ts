import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos de clientes y proveedores del registro de datos (ver `registro.ts`), en su propio archivo (una línea en el registro por módulo, sin pisar a los demás): los de la pantalla
 * «Clientes y proveedores» (formulario de la parte y filtros de la lista). Los largos, las listas cerradas y las formas viven UNA vez, en la ficha de cada dato (la primitiva o el archivo del
 * dominio); la pantalla no escribe ningún número. No se declaran «caminos» (precedente: «Mesas»).
 */

const FORMULARIO_DE_PARTE = "apps/web/ui/plantillas/clientes/FormularioDeParte.cliente.tsx";
const FILTROS_DEL_DIRECTORIO =
  "apps/web/ui/plantillas/clientes/FormularioDeFiltrosDelDirectorio.cliente.tsx";
const HOJA_DE_NUEVO_PROVEEDOR =
  "apps/web/ui/plantillas/compras/nueva/HojaDeNuevoProveedor.cliente.tsx";
const DATOS_DE_LA_PARTE = "src/modulos/clientes/dominio/datos-de-parte.ts";
const REQUIERE_CLIENTES = { modulo: "clientes", estadoDeEmpresa: ["ACTIVE"] } as const;
const PONER_PARTES = ["partes.crear", "partes.editar"] as const;

const FUENTE =
  "Pedernal-docs 10-ux-ui, maqueta directorio.html, aprobada el 09/11/2026 (tabla «Textos nuevos», fila «Formulario»), y e9-compras-especificacion.md §3.1";

const DE_LA_PARTE = (para: string): Proposito => ({ para, fuente: FUENTE });

const DEL_ALTA_RAPIDA = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs 10-ux-ui, maqueta compra.html, estados `prov-nuevo` y `prov-repetido` (aprobada el 09/11/2026: alta de proveedor en una ventana, sin salir de la compra) y 11-especificaciones/decisiones-del-dueno-2026-11.md (15/11/2026, puntos 8a y 8b)",
});

export const DATOS_DE_CLIENTES = {
  "naturaleza-de-parte": {
    ficha: "src/modulos/clientes/dominio/estados.ts",
    propositos: [
      DE_LA_PARTE("Si la parte es una persona o una empresa."),
      DEL_ALTA_RAPIDA(
        "Si el proveedor que se agrega desde «Nueva compra» es una persona o una empresa.",
      ),
    ],
    consumidores: [FORMULARIO_DE_PARTE, HOJA_DE_NUEVO_PROVEEDOR],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "nombre-de-parte": {
    ficha: "src/primitivas/texto/nombre-o-razon-social.ts",
    propositos: [
      DE_LA_PARTE("Nombre de la persona o razón social de la empresa."),
      DEL_ALTA_RAPIDA("Nombre del proveedor que se agrega desde «Nueva compra»."),
    ],
    consumidores: [FORMULARIO_DE_PARTE, HOJA_DE_NUEVO_PROVEEDOR],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "apellido-de-parte": {
    ficha: DATOS_DE_LA_PARTE,
    propositos: [DE_LA_PARTE("Apellido de la persona.")],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "alias-de-parte": {
    ficha: DATOS_DE_LA_PARTE,
    propositos: [DE_LA_PARTE("Alias con el que se conoce a la persona o empresa.")],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "nota-de-parte": {
    ficha: DATOS_DE_LA_PARTE,
    propositos: [DE_LA_PARTE("Nota libre sobre la persona o empresa.")],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "tipo-de-documento-de-parte": {
    ficha: "src/modulos/clientes/dominio/documento.ts",
    propositos: [DE_LA_PARTE("Tipo de documento de la parte (CUIT, CUIL, CDI, DNI, Pasaporte).")],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "documento-de-parte": {
    ficha: "src/modulos/clientes/dominio/documento.ts",
    propositos: [DE_LA_PARTE("Número del documento de la parte: único por empresa.")],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "pais-de-documento-de-parte": {
    ficha: "src/primitivas/identificacion-fiscal/pais.ts",
    propositos: [DE_LA_PARTE("País del pasaporte.")],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "condicion-iva-de-parte": {
    ficha: "src/primitivas/identificacion-fiscal/condicion-iva.ts",
    propositos: [DE_LA_PARTE("Condición frente al IVA de la parte.")],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "correo-de-parte": {
    ficha: "src/primitivas/contacto/email.ts",
    propositos: [DE_LA_PARTE("Email de la parte.")],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "telefono-de-parte": {
    ficha: "src/primitivas/contacto/telefono.ts",
    propositos: [DE_LA_PARTE("Teléfono de la parte.")],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "calle-de-parte": {
    ficha: "src/primitivas/domicilio/domicilio.ts",
    propositos: [DE_LA_PARTE("Calle del domicilio de la parte.")],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "numero-de-calle-de-parte": {
    ficha: "src/primitivas/domicilio/domicilio.ts",
    propositos: [DE_LA_PARTE("Número de la calle del domicilio de la parte.")],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "codigo-postal-de-parte": {
    ficha: "src/primitivas/domicilio/domicilio.ts",
    propositos: [DE_LA_PARTE("Código postal del domicilio de la parte.")],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "localidad-de-parte": {
    ficha: "src/primitivas/domicilio/domicilio.ts",
    propositos: [DE_LA_PARTE("Localidad del domicilio de la parte.")],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "provincia-de-parte": {
    ficha: "src/primitivas/domicilio/provincias.ts",
    propositos: [
      DE_LA_PARTE("Provincia del domicilio de la parte (una de las 24 jurisdicciones)."),
    ],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: PONER_PARTES,
    requiere: REQUIERE_CLIENTES,
  },
  "roles-de-parte": {
    ficha: "src/modulos/clientes/dominio/roles.ts",
    propositos: [
      DE_LA_PARTE(
        "Si la parte es cliente, proveedor o los dos (casillas «Cliente» y «Proveedor»).",
      ),
    ],
    consumidores: [FORMULARIO_DE_PARTE],
    ponerPor: ["partes.crear", "partes.cambiar_roles"],
    requiere: REQUIERE_CLIENTES,
  },
  "texto-de-busqueda-de-parte": {
    ficha: "src/modulos/clientes/dominio/busqueda.ts",
    propositos: [
      DE_LA_PARTE("Texto de la búsqueda de la lista: nombre, documento, email o teléfono."),
    ],
    consumidores: [FILTROS_DEL_DIRECTORIO],
    ponerPor: ["partes.ver"],
    requiere: REQUIERE_CLIENTES,
  },
  "rol-de-busqueda-de-parte": {
    ficha: "src/modulos/clientes/dominio/roles.ts",
    propositos: [DE_LA_PARTE("Filtro de la lista por rol: clientes o proveedores.")],
    consumidores: [FILTROS_DEL_DIRECTORIO],
    ponerPor: ["partes.ver"],
    requiere: REQUIERE_CLIENTES,
  },
  "incluir-desactivadas-de-parte": {
    ficha: "src/modulos/clientes/dominio/busqueda.ts",
    propositos: [DE_LA_PARTE("Casilla «Mostrar desactivados» de la lista.")],
    consumidores: [FILTROS_DEL_DIRECTORIO],
    ponerPor: ["partes.ver"],
    requiere: REQUIERE_CLIENTES,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
