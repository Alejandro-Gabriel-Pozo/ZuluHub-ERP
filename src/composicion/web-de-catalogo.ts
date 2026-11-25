import { crearTraedorDeProduccion } from "../adaptadores/imagenes-externas/traedor";
import { crearVidrieraPublica } from "../adaptadores/postgres/vidriera-publica";
import { crearMemoriaDeLogos } from "../capacidades/activos/memoria-de-logos";
import { CATALOGO_DE_MODULOS } from "../capacidades/modulos/catalogo";
import { CATALOGO_DE_PERILLAS } from "../capacidades/planes/perillas";
import type { ContextoOperativo } from "../contexto/contexto";
import { crearCasosDeUsoDeCatalogo, crearConsultasDeCatalogo } from "../modulos/catalogo/publico";
import { crearExistenciasDeCatalogo, generarCodigoDeCarta } from "./existencias-de-catalogo";
import { ok } from "../primitivas/resultado/resultado";
import { perezoso } from "./perezoso";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeCatalogo({ conexiones, reglas, reloj }: BaseDeWeb) {
  return {
    /**
     * La carta pública con datos REALES (T3 de la carta real): la misma puerta pública (`PEDERNAL_DB_PUBLICO`, rol `pedernal_publico`), solo lectura. Hoy `apps/web`
     * sigue con la carta de ejemplo hasta que T5 la corte y la pantalla lea de acá.
     */
    vidrieraPublica: perezoso(() =>
      crearVidrieraPublica(conexiones.transaccionesPublicas(), reloj, {
        catalogoDeModulos: CATALOGO_DE_MODULOS,
        catalogoDePerillas: CATALOGO_DE_PERILLAS,
      }),
    ),
    /**
     * La dirección propia ACTIVA de la carta de la empresa del contexto (dominio propio): una lectura de solo lectura con el rol de la app, que ve únicamente lo de su empresa
     * (0095). El permiso ya lo exigió la consulta de la carta que la precede; acá no se decide ninguno.
     */
    hostPropioDeLaCarta: perezoso(
      () =>
        async (contexto: ContextoOperativo): Promise<string | null> => {
          const leido = await conexiones
            .transaccionesDeApp()
            .ejecutar({ contexto, aislamiento: "read committed", soloLectura: true }, async (tx) =>
              ok(await tx.hostsPropios.activoDe("CARTA")),
            );
          // `ok` es el único camino: lo demás (un error de la base) sale como excepción y llega a `aRespuestaDeExcepcion`.
          return leido.ok ? leido.valor : null;
        },
    ),
    /**
     * El logo de la carta por dirección externa (§5.7.5): el traedor seguro de imágenes y la memoria de lo traído (acotada, con corte de fallos). Una sola de cada una por
     * instancia del servidor: el contador de conexiones salientes y la memoria tienen que ser compartidos por todos los pedidos.
     */
    imagenesExternas: perezoso(() => crearTraedorDeProduccion()),
    memoriaDeLogos: perezoso(() => crearMemoriaDeLogos(() => reloj.ahora().getTime())),
    /**
     * El catálogo (E2 mínimo): productos, forma de venta, precios, opciones, consumo, copia y secciones de la carta, y sus consultas. Cada
     * uno exige SU acción al guard dentro de la transacción. El módulo `catalogo` sigue `en_desarrollo`: el guard rechaza todo con
     * `MODULO_EN_DESARROLLO` hasta que el dueño lo pase a disponible. `cotizarParaVender` no sale por acá: es el puerto de ventas.
     */
    casosDeUsoDeCatalogo: perezoso(() =>
      crearCasosDeUsoDeCatalogo({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        existencias: crearExistenciasDeCatalogo(),
        generarCodigoDeCarta,
      }),
    ),
    consultasDeCatalogo: perezoso(() =>
      crearConsultasDeCatalogo({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
  };
}
