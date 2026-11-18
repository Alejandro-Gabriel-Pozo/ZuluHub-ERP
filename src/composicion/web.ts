/**
 * ARCHIVO CENTRAL
 * QUÉ ES: la composición que usa la app web; arma la base común y junta lo que aporta cada módulo.
 * QUÉ NO ES: el lugar donde se conectan los casos de uso de un módulo.
 * EXPORTA: OpcionesDeWeb, armarWeb, Web
 * IMPORTA: solo de ./web-base, ./web-de-*, ./conexiones, ./emision-fiscal, ./cadenas-de-confianza-de-arca, la matriz de permisos y los tipos de las opciones.
 * PARTE DEDICADA: src/composicion/web-de-<carpeta de src/modulos>.ts
 */
import type { CadenasDeConfianza } from "../adaptadores/certificados/lector-x509";
import { REGLAS_DE_EMPRESA, type ReglasDeEmpresa } from "../capacidades/permisos/empresa";
import type { ProveedorDeEmision } from "../modulos/fiscal/publico";
import type { LecturasCompartidas } from "../puertos/transacciones";
import { CADENAS_DE_CONFIANZA_DE_ARCA } from "./cadenas-de-confianza-de-arca";
import type { Conexiones } from "./conexiones";
import { armarEmisionFiscal } from "./emision-fiscal";
import type { BaseDeWeb } from "./web-base";
import { armarWebDeCaja } from "./web-de-caja";
import { armarWebDeCatalogo } from "./web-de-catalogo";
import { armarWebDeCierre } from "./web-de-cierre";
import { armarWebDeClientes } from "./web-de-clientes";
import { armarWebDeComandas } from "./web-de-comandas";
import { armarWebDeCompras } from "./web-de-compras";
import { armarWebDeEmpresas } from "./web-de-empresas";
import { armarWebDeFiscal } from "./web-de-fiscal";
import { armarWebDeIdentidad } from "./web-de-identidad";
import { armarWebDeProduccion } from "./web-de-produccion";
import { armarWebDeSalon } from "./web-de-salon";
import { armarWebDeStock } from "./web-de-stock";
import { armarWebDeVentas } from "./web-de-ventas";

/**
 * Lo que ofrece la composición a la aplicación web: los casos de uso y las consultas de empresas e
 * identidad que ya existen, armados a mano (sin contenedor de inyección) sobre las conexiones. Cada
 * grupo se arma la primera vez que se pide; hasta entonces no se lee ninguna variable.
 *
 * La resolución de un host a su dueño y su marca (`resolucionDeHost`, M4) es la puerta pública: sin
 * sesión, solo lectura, con su propia conexión. Devuelve el host servible o nada. Cómo se pinta su marca
 * (`configuracionPublicaDeHost`, M4b: nombre, tema validado y host canónico) sale por la misma puerta;
 * el logo y el vocabulario llegan con la puerta web (M9).
 *
 * Lo de cada módulo se arma en su archivo `web-de-<carpeta>.ts`; lo fiscal (H7: qué sale, qué queda afuera a propósito y por qué) está
 * explicado en `web-de-fiscal.ts`. `consultasDeSesion` (la
 * persona del usuario y sus empresas, puerta `SESION`) llegó con W3a. La autenticación (W3b) es otra
 * puerta: `autenticacion()` dice QUIÉN es (usuario y email verificado, por host) y `barridoDeAutenticacion()`
 * es lo que llama el cron; la persona y las empresas salen después, con el contexto `SESION`.
 */
export type OpcionesDeWeb = Readonly<{
  /** El catálogo y la matriz con los que el guard autoriza; por defecto, los reales. En pruebas, uno con `facturacion` disponible. */
  reglas?: ReglasDeEmpresa;
  /** Quién habla con ARCA; por defecto, el real por (emisor, ambiente). En pruebas, el falso. */
  emision?: ProveedorDeEmision;
  /** La hora de lo que sigue a una llamada a ARCA; por defecto, el reloj del sistema. */
  reloj?: Readonly<{ ahora(): Date }>;
  /**
   * Las autoridades (PEM) de ARCA contra las que cierra la cadena de un certificado cargado, por ambiente. Por defecto, las verificadas de
   * `cadenas-de-confianza-de-arca.ts` (homologación; producción vacía y falla cerrado). En pruebas, las que nacen en la propia prueba.
   */
  cadenasDeConfianza?: CadenasDeConfianza;
}>;

export function armarWeb(conexiones: Conexiones, opciones: OpcionesDeWeb = {}) {
  const reglas = opciones.reglas ?? REGLAS_DE_EMPRESA;
  const reloj = opciones.reloj ?? { ahora: () => new Date() };
  // Armarlo no lee ninguna variable: el proveedor pide la clave de los certificados recién al hablar con ARCA.
  const emision = opciones.emision ?? armarEmisionFiscal(conexiones, { reloj });
  const cadenasDeConfianza = opciones.cadenasDeConfianza ?? CADENAS_DE_CONFIANZA_DE_ARCA;
  const base: BaseDeWeb = { conexiones, reglas, reloj, emision, cadenasDeConfianza };
  return {
    resolucionDeHost: () => conexiones.resolucionDeHost(),
    configuracionPublicaDeHost: () => conexiones.configuracionPublicaDeHost(),
    autenticacion: () => conexiones.autenticacion(),
    barridoDeAutenticacion: () => conexiones.barridoDeAutenticacion(),
    /** Las lecturas de un pedido que comparten una transacción (ver `LecturasCompartidas`): la misma conexión que usan las consultas. */
    lecturasCompartidas: (): LecturasCompartidas => conexiones.transaccionesDeApp(),
    ...armarWebDeEmpresas(base),
    ...armarWebDeCatalogo(base),
    ...armarWebDeCierre(base),
    ...armarWebDeCaja(base),
    ...armarWebDeVentas(base),
    ...armarWebDeStock(base),
    ...armarWebDeProduccion(base),
    ...armarWebDeComandas(base),
    ...armarWebDeSalon(base),
    ...armarWebDeClientes(base),
    ...armarWebDeCompras(base),
    ...armarWebDeIdentidad(base),
    ...armarWebDeFiscal(base),
  };
}

export type Web = ReturnType<typeof armarWeb>;
