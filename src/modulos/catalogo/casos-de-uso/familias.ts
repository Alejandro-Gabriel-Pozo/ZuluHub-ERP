import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { vendeLaClase } from "../dominio/clases";
import { hayLugarEnLaFamilia, nombreDeFamiliaDesdeTexto } from "../dominio/familia";
import { esUuid } from "../dominio/identificadores";
import { autorizar, exigirAlcanceTotal, traducir } from "./comun";
import type { DependenciasDeCatalogo } from "./contrato";
import type { ErrorDeCatalogo } from "./errores";

type R<S> = Resultado<S, ErrorDeCatalogo>;

export type EntradaDeCrearFamilia = Readonly<{
  /** Lo manda la aplicación: es la clave de idempotencia del alta. */
  id: string;
  nombre: string;
}>;
export type SalidaDeCrearFamilia = Readonly<{
  familiaId: string;
  version: number;
  yaExistia: boolean;
}>;

export type EntradaDeEditarFamilia = Readonly<{
  familiaId: string;
  versionEsperada: number;
  /** Cada campo, si viene, es el ESTADO que se quiere (no «alternar»). */
  nombre?: string;
  agruparEnCarta?: boolean;
  agruparEnPos?: boolean;
  activa?: boolean;
}>;
export type SalidaDeEditarFamilia = Readonly<{ version: number; yaEstaba: boolean }>;

export type EntradaDeCambiarMiembroDeFamilia = Readonly<{
  familiaId: string;
  productoId: string;
  versionEsperada: number;
}>;
export type SalidaDeCambiarMiembroDeFamilia = Readonly<{
  version: number;
  yaEstaba: boolean;
  /** Cuántos miembros vigentes tiene la familia después. */
  miembros: number;
  /** Con menos de dos miembros la familia no se agrupa: lo ve la pantalla como aviso, no es un error. */
  seAgrupa: boolean;
}>;

/**
 * Crear una familia (A8, CU-F1). Acción `productos.editar` con alcance TODAS (DDD 122, punto 4: quien edita productos crea y edita familias). El `id` lo manda la
 * aplicación: repetir con el mismo contenido es `yaExistia` sin escribir ni auditar; con otro nombre, `ID_REUTILIZADO`. Nace con los dos interruptores apagados y activa.
 * El nombre es único por empresa sin distinguir mayúsculas (`FAMILIA_DUPLICADA`).
 */
export function armarCrearFamilia(dependencias: DependenciasDeCatalogo) {
  return async function crearFamilia(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearFamilia,
  ): Promise<R<SalidaDeCrearFamilia>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCrearFamilia>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (!esUuid(entrada.id)) return err("IDENTIFICADOR_INVALIDO");
        const nombre = nombreDeFamiliaDesdeTexto(entrada.nombre);
        if (!nombre.ok) return nombre;
        const insertada = await tx.familias.insertar(empresaId, {
          id: entrada.id,
          nombre: nombre.valor.nombre,
          nombreClave: nombre.valor.nombreClave,
          creadoPor: contexto.personaId,
        });
        if (!insertada) {
          const guardada = await tx.familias.obtener(empresaId, entrada.id);
          return guardada !== null && guardada.nombreClave === nombre.valor.nombreClave
            ? ok({ familiaId: guardada.id, version: guardada.version, yaExistia: true })
            : err("ID_REUTILIZADO");
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "FAMILIA_CREADA",
          entidad: "familia_de_producto",
          entidadId: entrada.id,
          despues: { nombre: nombre.valor.nombre },
        });
        return ok({ familiaId: entrada.id, version: 1, yaExistia: false });
      },
    );
    return traducir(resultado);
  };
}

/**
 * Editar una familia: nombre, «Agrupar en la carta», «Agrupar en el POS» y activa/desactivada (CU-F2 y CU-F5). Acción `productos.editar`, alcance TODAS. Pide el ESTADO
 * deseado: si la familia ya está así, es `yaEstaba` sin escribir ni auditar (aunque la versión sea vieja: repetir lo ya aplicado). Si no, compara la versión
 * (`VERSION_DESACTUALIZADA`). La familia se toma `FOR UPDATE`: dos cambios a la vez se ponen en fila. Desactivar NO toca a los productos ni los saca de la familia.
 */
export function armarEditarFamilia(dependencias: DependenciasDeCatalogo) {
  return async function editarFamilia(
    contexto: ContextoOperativo,
    entrada: EntradaDeEditarFamilia,
  ): Promise<R<SalidaDeEditarFamilia>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeEditarFamilia>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (!esUuid(entrada.familiaId)) return err("IDENTIFICADOR_INVALIDO");
        if (!Number.isInteger(entrada.versionEsperada) || entrada.versionEsperada < 1)
          return err("VERSION_DESACTUALIZADA");
        const nombre =
          entrada.nombre === undefined ? null : nombreDeFamiliaDesdeTexto(entrada.nombre);
        if (nombre !== null && !nombre.ok) return nombre;
        const actual = await tx.familias.bloquear(empresaId, entrada.familiaId);
        if (actual === null) return err("FAMILIA_NO_ENCONTRADA");
        const deseada = {
          nombre: nombre === null ? actual.nombre : nombre.valor.nombre,
          nombreClave: nombre === null ? actual.nombreClave : nombre.valor.nombreClave,
          agruparEnCarta: entrada.agruparEnCarta ?? actual.agruparEnCarta,
          agruparEnPos: entrada.agruparEnPos ?? actual.agruparEnPos,
          activa: entrada.activa ?? actual.activa,
        };
        const igual =
          deseada.nombre === actual.nombre &&
          deseada.agruparEnCarta === actual.agruparEnCarta &&
          deseada.agruparEnPos === actual.agruparEnPos &&
          deseada.activa === actual.activa;
        if (igual) return ok({ version: actual.version, yaEstaba: true });
        if (actual.version !== entrada.versionEsperada) return err("VERSION_DESACTUALIZADA");
        const nueva = await tx.familias.actualizar(
          empresaId,
          actual.id,
          entrada.versionEsperada,
          deseada,
        );
        if (nueva === null) return err("VERSION_DESACTUALIZADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "FAMILIA_EDITADA",
          entidad: "familia_de_producto",
          entidadId: actual.id,
          antes: {
            nombre: actual.nombre,
            agruparEnCarta: actual.agruparEnCarta,
            agruparEnPos: actual.agruparEnPos,
            activa: actual.activa,
          },
          despues: {
            nombre: nueva.nombre,
            agruparEnCarta: nueva.agruparEnCarta,
            agruparEnPos: nueva.agruparEnPos,
            activa: nueva.activa,
          },
        });
        return ok({ version: nueva.version, yaEstaba: false });
      },
    );
    return traducir(resultado);
  };
}

/**
 * Agregar un producto a una familia (CU-F3). Acción `productos.editar`, alcance TODAS. Orden fijo de bloqueos: primero la familia, después el producto. Solo agrega la
 * PERTENENCIA: no cambia el precio, la receta ni el stock. Ya está en esta familia: `yaEstaba`, sin escribir. Está en OTRA: `PRODUCTO_EN_OTRA_FAMILIA` (y si dos
 * lo agregan a la vez a familias distintas, el índice único de la base deja pasar a uno solo). Compara la versión de la familia y la sube (quien miraba la familia
 * antes se entera). Tope de 50 miembros (`FAMILIA_LLENA`). El producto tiene que existir en la empresa y venderse.
 */
export function armarAgregarProductoAFamilia(dependencias: DependenciasDeCatalogo) {
  return async function agregarProductoAFamilia(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarMiembroDeFamilia,
  ): Promise<R<SalidaDeCambiarMiembroDeFamilia>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCambiarMiembroDeFamilia>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (!esUuid(entrada.familiaId) || !esUuid(entrada.productoId))
          return err("IDENTIFICADOR_INVALIDO");
        if (!Number.isInteger(entrada.versionEsperada) || entrada.versionEsperada < 1)
          return err("VERSION_DESACTUALIZADA");
        const familia = await tx.familias.bloquear(empresaId, entrada.familiaId);
        if (familia === null) return err("FAMILIA_NO_ENCONTRADA");
        const producto = await tx.productos.bloquear(empresaId, entrada.productoId);
        if (producto === null) return err("PRODUCTO_NO_ENCONTRADO");
        if (!vendeLaClase(producto.claseDeUso)) return err("PRODUCTO_NO_VENDIBLE");
        const vigentes = await tx.familias.miembrosVigentes(empresaId, familia.id);
        const vinculo = await tx.familias.vinculoVigenteDelProducto(empresaId, producto.id);
        if (vinculo !== null) {
          if (vinculo.familiaId !== familia.id) return err("PRODUCTO_EN_OTRA_FAMILIA");
          return ok({
            version: familia.version,
            yaEstaba: true,
            miembros: vigentes.length,
            seAgrupa: vigentes.length >= 2,
          });
        }
        if (familia.version !== entrada.versionEsperada) return err("VERSION_DESACTUALIZADA");
        if (!hayLugarEnLaFamilia(vigentes.length)) return err("FAMILIA_LLENA");
        const posicion = vigentes.reduce((mayor, m) => Math.max(mayor, m.posicion), 0) + 1;
        await tx.familias.agregarMiembro(empresaId, {
          familiaId: familia.id,
          productoId: producto.id,
          posicion,
          agregadoPor: contexto.personaId,
          agregadoEn: contexto.ahora,
        });
        const nueva = await tx.familias.tocar(empresaId, familia.id);
        if (nueva === null) return err("FAMILIA_NO_ENCONTRADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "PRODUCTO_AGREGADO_A_FAMILIA",
          entidad: "familia_de_producto",
          entidadId: familia.id,
          despues: { productoId: producto.id, posicion },
        });
        return ok({
          version: nueva.version,
          yaEstaba: false,
          miembros: vigentes.length + 1,
          seAgrupa: vigentes.length + 1 >= 2,
        });
      },
    );
    return traducir(resultado);
  };
}

/**
 * Quitar un producto de una familia (CU-F4). Acción `productos.editar`, alcance TODAS. Pide el estado «fuera de la familia»: si ya no estaba, `yaEstaba` sin escribir.
 * No se borra nada: el vínculo termina con quién y cuándo (volver a agregarlo, o «Deshacer», es un cambio nuevo). El producto vuelve a salir suelto; no cambia su
 * precio ni su receta. Queda con menos de dos: se guarda igual y la respuesta dice `seAgrupa: false`.
 */
export function armarQuitarProductoDeFamilia(dependencias: DependenciasDeCatalogo) {
  return async function quitarProductoDeFamilia(
    contexto: ContextoOperativo,
    entrada: EntradaDeCambiarMiembroDeFamilia,
  ): Promise<R<SalidaDeCambiarMiembroDeFamilia>> {
    const { empresaId } = contexto;
    const resultado = await dependencias.transacciones.ejecutar(
      { contexto },
      async (tx): Promise<R<SalidaDeCambiarMiembroDeFamilia>> => {
        const permiso = await autorizar(tx, contexto, dependencias.reglas, ["productos.editar"]);
        if (!permiso.ok) return permiso;
        const alcance = await exigirAlcanceTotal(tx, contexto);
        if (!alcance.ok) return alcance;
        if (!esUuid(entrada.familiaId) || !esUuid(entrada.productoId))
          return err("IDENTIFICADOR_INVALIDO");
        if (!Number.isInteger(entrada.versionEsperada) || entrada.versionEsperada < 1)
          return err("VERSION_DESACTUALIZADA");
        const familia = await tx.familias.bloquear(empresaId, entrada.familiaId);
        if (familia === null) return err("FAMILIA_NO_ENCONTRADA");
        const vigentes = await tx.familias.miembrosVigentes(empresaId, familia.id);
        if (!vigentes.some((m) => m.productoId === entrada.productoId)) {
          return ok({
            version: familia.version,
            yaEstaba: true,
            miembros: vigentes.length,
            seAgrupa: vigentes.length >= 2,
          });
        }
        if (familia.version !== entrada.versionEsperada) return err("VERSION_DESACTUALIZADA");
        const quitado = await tx.familias.quitarMiembro(empresaId, {
          familiaId: familia.id,
          productoId: entrada.productoId,
          quitadoPor: contexto.personaId,
          quitadoEn: contexto.ahora,
        });
        if (!quitado) return err("VERSION_DESACTUALIZADA");
        const nueva = await tx.familias.tocar(empresaId, familia.id);
        if (nueva === null) return err("FAMILIA_NO_ENCONTRADA");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "PRODUCTO_QUITADO_DE_FAMILIA",
          entidad: "familia_de_producto",
          entidadId: familia.id,
          antes: { productoId: entrada.productoId },
        });
        return ok({
          version: nueva.version,
          yaEstaba: false,
          miembros: vigentes.length - 1,
          seAgrupa: vigentes.length - 1 >= 2,
        });
      },
    );
    return traducir(resultado);
  };
}
