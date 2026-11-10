import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { claveDeNombre } from "../../../primitivas/texto/nombre-de-producto";
import { vendeLaClase } from "../dominio/clases";
import {
  copiaDeOpcionesId,
  esUuid,
  grupoDeEleccionesId,
  type CopiaDeOpcionesId,
} from "../dominio/identificadores";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeCopiarOpciones = Readonly<{
  /** El `id` de la copia lo manda la aplicación: es la clave de idempotencia de «Copiar de otro producto». */
  copiaId: string;
  productoOrigenId: string;
  productoDestinoId: string;
  versionDeOpcionesEsperada: number;
}>;

export type SalidaDeCopiarOpciones = Readonly<{
  copiaId: CopiaDeOpcionesId;
  yaExistia: boolean;
  gruposCopiados: number;
  opcionesCopiadas: number;
  preciosCopiados: number;
}>;

/**
 * «Copiar de otro producto» (133 y 136; §3.5). Guard `opciones.editar`, alcance TODAS. Bloquea los dos productos (en orden de id, para no
 * trabarse con otra copia en sentido contrario). REPETICIÓN: si ya hay una copia con ese `copiaId` (mismo origen y destino) devuelve
 * `yaExistia: true` sin copiar de nuevo; con otro origen o destino, `ID_REUTILIZADO`. Si no: el origen existe (puede estar inactivo), el
 * destino está activo y se vende, son distintos; compara `versionDeOpcionesEsperada` del destino. Trae del origen los grupos ACTIVOS cuyo nombre
 * (por clave) el destino no tiene, con sus opciones activas y recargos vigentes. Trae la VARIANTE con los precios de la EMPRESA de cada
 * tamaño solo si el destino no tiene variante activa ni precio vigente de la empresa y los dos se venden en la misma unidad y paso (regla del
 * prototipo; SUPUESTO: con otra forma de venta los precios no valen igual y se deja afuera la variante entera). NO trae lo que consume cada
 * opción (139: es propio de cada producto) ni precios de sucursal (SUPUESTO S5). La copia es independiente: ningún vínculo con el origen.
 * Sin nada que traer, `NADA_PARA_COPIAR`. Todo en una transacción: nunca queda un producto con la mitad de los grupos.
 */
export function armarCopiarOpciones(dependencias: DependenciasDeCatalogo) {
  return async function copiarOpciones(
    contexto: ContextoOperativo,
    entrada: EntradaDeCopiarOpciones,
  ): Promise<R<SalidaDeCopiarOpciones>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCopiarOpciones>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["opciones.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (!esUuid(entrada.copiaId)) return err("IDENTIFICADOR_INVALIDO");
        if (entrada.productoOrigenId === entrada.productoDestinoId) return err("COPIA_A_SI_MISMO");
        const [primero, segundo] = [entrada.productoOrigenId, entrada.productoDestinoId].sort();
        const a = await tx.productos.bloquear(empresaId, primero ?? "");
        const b = await tx.productos.bloquear(empresaId, segundo ?? "");
        const origen = primero === entrada.productoOrigenId ? a : b;
        const destino = primero === entrada.productoOrigenId ? b : a;
        if (origen === null || destino === null) return err("PRODUCTO_NO_ENCONTRADO");
        const copiaId = copiaDeOpcionesId(entrada.copiaId);

        const previa = await tx.opciones.obtenerCopia(empresaId, entrada.copiaId);
        if (previa !== null) {
          const igual =
            previa.productoOrigenId === origen.id && previa.productoDestinoId === destino.id;
          return igual
            ? ok({
                copiaId,
                yaExistia: true,
                gruposCopiados: 0,
                opcionesCopiadas: 0,
                preciosCopiados: 0,
              })
            : err("ID_REUTILIZADO");
        }
        if (!destino.activo) return err("PRODUCTO_INACTIVO");
        if (!vendeLaClase(destino.claseDeUso)) return err("PRODUCTO_NO_VENDIBLE");
        if (entrada.versionDeOpcionesEsperada !== destino.versionDeOpciones)
          return err("OPCIONES_DESACTUALIZADAS");

        const gruposOrigen = (await tx.opciones.gruposDelProducto(empresaId, origen.id)).filter(
          (g) => g.grupo.activo,
        );
        const gruposDestino = await tx.opciones.gruposDelProducto(empresaId, destino.id);
        const clavesDelDestino = new Set(gruposDestino.map((g) => claveDeNombre(g.grupo.nombre)));
        const destinoTieneVariante = gruposDestino.some(
          (g) => g.grupo.clase === "VARIANTE" && g.grupo.activo,
        );
        const precioDelDestino = await tx.precios.vigente(
          empresaId,
          destino.id,
          null,
          null,
          contexto.ahora,
        );
        const mismaForma =
          origen.unidadDeVentaId === destino.unidadDeVentaId &&
          origen.pasoMinimo === destino.pasoMinimo;
        const puedeTraerLaVariante =
          !destinoTieneVariante &&
          (precioDelDestino === null || precioDelDestino.precio === null) &&
          mismaForma;

        let gruposCopiados = 0;
        let opcionesCopiadas = 0;
        let preciosCopiados = 0;
        for (const { grupo, opciones } of gruposOrigen) {
          if (clavesDelDestino.has(claveDeNombre(grupo.nombre))) continue;
          if (grupo.clase === "VARIANTE" && !puedeTraerLaVariante) continue;
          const activas = opciones.filter((o) => o.activa);
          if (activas.length === 0) continue;
          const nuevoGrupo = await tx.opciones.insertarGrupo(empresaId, destino.id, {
            clase: grupo.clase,
            esTamano: grupo.esTamano,
            nombre: grupo.nombre,
            nombreClave: claveDeNombre(grupo.nombre),
            esObligatorio: grupo.esObligatorio,
            admiteVarias: grupo.admiteVarias,
            seMuestraEnCarta: grupo.seMuestraEnCarta,
            orden: grupo.orden,
            activo: true,
          });
          gruposCopiados += 1;
          for (const o of activas) {
            const nueva = await tx.opciones.insertarOpcion(
              empresaId,
              destino.id,
              grupoDeEleccionesId(nuevoGrupo),
              {
                nombreClave: claveDeNombre(o.nombre),
                orden: o.orden,
              },
            );
            await tx.opciones.insertarVersion(empresaId, {
              opcionId: nueva,
              numero: 1,
              nombre: o.nombre,
              recargo: o.recargo,
              factorDeTamano: o.factorDeTamano,
              cargadaPor: contexto.personaId,
              creadaEn: contexto.ahora,
            });
            opcionesCopiadas += 1;
            if (grupo.clase === "VARIANTE") {
              const precio = await tx.precios.vigente(
                empresaId,
                origen.id,
                o.id,
                null,
                contexto.ahora,
              );
              if (precio !== null && precio.precio !== null) {
                const insertado = await tx.precios.insertar(empresaId, {
                  productoId: destino.id,
                  opcionId: nueva,
                  sucursalId: null,
                  precio: precio.precio,
                  unidadId: destino.unidadDeVentaId,
                  pasoMinimo: destino.pasoMinimo,
                  ahora: contexto.ahora,
                  cargadoPor: contexto.personaId,
                });
                if (insertado === null)
                  throw new Error(
                    "la base devolvió un precio nuevo sin fila: el id lo genera ella",
                  );
                preciosCopiados += 1;
              }
            }
          }
        }
        if (gruposCopiados === 0) return err("NADA_PARA_COPIAR");
        const registrada = await tx.opciones.registrarCopia(
          empresaId,
          copiaId,
          origen.id,
          destino.id,
          contexto.personaId,
        );
        // Un `copiaId` que otra transacción registró desde la lectura de arriba aborta por serialización y se repite como repetición.
        if (!registrada) {
          throw new Error(
            "la copia ya estaba registrada sin haberse visto: debió abortar por serialización",
          );
        }
        const subido = await tx.productos.subirVersionDeOpciones(empresaId, destino.id);
        if (subido === null) return err("PRODUCTO_NO_ENCONTRADO");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "OPCIONES_COPIADAS",
          entidad: "producto",
          entidadId: destino.id,
          antes: { versionDeOpciones: destino.versionDeOpciones },
          despues: {
            versionDeOpciones: subido.versionDeOpciones,
            origenId: origen.id,
            copiaId,
            gruposCopiados,
            opcionesCopiadas,
            preciosCopiados,
          },
        });
        return ok({ copiaId, yaExistia: false, gruposCopiados, opcionesCopiadas, preciosCopiados });
      },
    );
    return traducir(resultado);
  };
}
