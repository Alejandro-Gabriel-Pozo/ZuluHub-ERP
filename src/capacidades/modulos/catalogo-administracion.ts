/**
 * Un solo módulo real: `administracion`, obligatorio (no hay tabla de módulos activos: ver la
 * especificación de H4, §B.4). Una acción por caso de uso (cruce X1); quién puede cada una se
 * define en `permisos/empresa.ts`.
 *
 * Es el NÚCLEO (empresas, sucursales, identidad y la configuración fiscal del gerente): no depende de un
 * plan, así que nunca queda en solo lectura (el guard ignora ese estado en los módulos obligatorios).
 * Aun así cada acción declara su `efecto`, para que no haya acciones sin clasificar.
 * Criterio: lo que quita, cierra o responde algo ya iniciado (apagar, revocar o reenviar una
 * invitación, desactivar una sucursal, cancelar, aceptar o rechazar un traspaso) es `COMPLETA_CIERRA`;
 * lo que da de alta, cambia la configuración, reactiva o amplía un alcance (invitar, asignar
 * sucursales, crear, editar y reactivar sucursales, proponer un traspaso) es `CREA_AMPLIA`.
 */
export const MODULO_DE_ADMINISTRACION = {
  estado: "disponible",
  obligatorio: true,
  requiere: [],
  usaSiExiste: [],
  datosRequeridos: [],
  implementadoPor: ["modulos/identidad", "modulos/empresas", "modulos/fiscal"],
  acciones: {
    "usuarios.invitar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "usuarios.reenviar_invitacion": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "usuarios.apagar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "usuarios.ver": { capacidad: null, efecto: "LECTURA" },
    "usuarios.asignar_sucursales": { capacidad: null, efecto: "CREA_AMPLIA" },
    "usuarios.revocar_invitacion": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    // H4b T4 (roles propios): solo el gerente (piso SOLO_GERENTE de 0097). Crear y editar un rol crean o amplían; archivar cierra; reactivar es una opción de editar (pide `roles.editar`).
    // `usuarios.asignar_rol` llega con el caso de uso que asigna (T4b-2); su piso ya está en 0097.
    "roles.ver": { capacidad: null, efecto: "LECTURA" },
    "roles.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
    "roles.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "roles.archivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    // Asignar un rol a una persona amplía (o recorta) lo que esa persona puede hacer; solo el gerente.
    "usuarios.asignar_rol": { capacidad: null, efecto: "CREA_AMPLIA" },
    "sucursales.ver": { capacidad: null, efecto: "LECTURA" },
    "sucursales.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
    "sucursales.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "sucursales.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "sucursales.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "gerencia.proponer_traspaso": { capacidad: null, efecto: "CREA_AMPLIA" },
    "gerencia.cancelar_traspaso": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "gerencia.ver_traspaso": { capacidad: null, efecto: "LECTURA" },
    "gerencia.aceptar_traspaso": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "gerencia.rechazar_traspaso": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "modulos.ver": { capacidad: null, efecto: "LECTURA" },
    "permisos.ver_propios": { capacidad: null, efecto: "LECTURA" },
    // H7 fiscal §C (T5): la configuración fiscal del gerente. Vive acá y no en `facturacion` porque son los
    // `datosRequeridos` de la facturación: si dependieran de ella (que cada empresa tiene que activar), el gerente nunca podría
    // dejarlos listos. Guardar un borrador, crear, editar y activar un punto de venta o confirmar la regla del
    // emisor crean o amplían; confirmar los datos fiscales y desactivar un punto de venta cierran.
    "datos_fiscales.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "datos_fiscales.confirmar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "puntos_de_venta.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
    "puntos_de_venta.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "puntos_de_venta.activar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "puntos_de_venta.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "emisores.confirmar_regla": { capacidad: null, efecto: "CREA_AMPLIA" },
  },
} as const;
