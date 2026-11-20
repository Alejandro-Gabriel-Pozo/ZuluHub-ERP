/**
 * Los textos del módulo `clientes` (prefijo `clientes.`, E9-T15; `e9-compras-especificacion.md` §10). Ninguno es nuevo: todos salen de los que el
 * dueño aprobó el 09/11/2026 en el prototipo `directorio.html`, sección «Textos nuevos» (repositorio de documentos,
 * `10-ux-ui/prototipos-gastronomia/directorio.html`). Los rótulos del formulario no figuraban en la lista de
 * `e9-compras-especificacion.md` §10 y la decisión D175 no los agregó; DEC-0566 carga los que no existían en ningún catálogo (los demás se reusan).
 */
export const TEXTOS_DE_CLIENTES = {
  // directorio.html, «Textos nuevos» (09/11/2026), fila «Lista y ficha»
  "clientes.lista.clientes_y_proveedores": { porDefecto: "Clientes y proveedores" },
  "clientes.lista.persona": { porDefecto: "Persona" },
  "clientes.lista.empresa": { porDefecto: "Empresa" },
  "clientes.lista.razon_social": { porDefecto: "Razón social" },
  "clientes.lista.documento": { porDefecto: "Documento" },
  "clientes.lista.condicion_frente_al_iva": { porDefecto: "Condición frente al IVA" },
  "clientes.lista.posibles_duplicados": { porDefecto: "Posibles duplicados" },
  "clientes.lista.guardar_igual": { porDefecto: "Guardar igual" },
  "clientes.lista.contactos": { porDefecto: "Contactos" },
  "clientes.lista.agregar_contacto": { porDefecto: "Agregar contacto" },
  "clientes.lista.cargo": { porDefecto: "Cargo" },
  "clientes.lista.desactivar": { porDefecto: "Desactivar" },
  "clientes.lista.reactivar": { porDefecto: "Reactivar" },
  "clientes.lista.mostrar_desactivados": { porDefecto: "Mostrar desactivados" },

  // directorio.html:266, «Textos nuevos» (aprobados el 09/11/2026, DEC-0566): los once que no tenían clave (`pantallas-de-compras-inventario.md` §5). Los demás rótulos del formulario
  // («Nombre», «Domicilio», «Calle», «Guardar»…) ya existen en otros catálogos y se reusan.
  "clientes.lista.nuevo": { porDefecto: "Nuevo" },
  "clientes.lista.clientes": { porDefecto: "Clientes" },
  "clientes.lista.proveedores": { porDefecto: "Proveedores" },
  "clientes.formulario.tipo_de_documento": { porDefecto: "Tipo de documento" },
  "clientes.formulario.pais": { porDefecto: "País" },
  "clientes.formulario.nota": { porDefecto: "Nota" },
  "clientes.formulario.roles": { porDefecto: "Roles" },
  "clientes.formulario.email": { porDefecto: "Email" },
  "clientes.formulario.apellido": { porDefecto: "Apellido" },

  // directorio.html, «Textos nuevos», fila «Errores»; los códigos DOCUMENTO_YA_REGISTRADO y PARTE_INACTIVA_CON_ESE_DOCUMENTO son de E9 §3.1
  "clientes.error.cuit_invalido": { porDefecto: "El CUIT no es válido" },
  "clientes.error.documento_ya_registrado": {
    porDefecto: "Ya existe una persona o empresa con ese documento",
  },
  "clientes.error.parte_inactiva_con_ese_documento": {
    porDefecto: "Ya existe, pero está desactivada",
  },
  "clientes.error.falta_el_nombre": { porDefecto: "Falta el nombre" },
  "clientes.error.email_invalido": { porDefecto: "El email no es válido" },
  "clientes.error.telefono_invalido": { porDefecto: "El teléfono no es válido" },
  "clientes.error.dni_invalido": { porDefecto: "El DNI no es válido" },
  "clientes.error.empresa_solo_cuit_o_extranjero": {
    porDefecto: "Una empresa solo admite CUIT o documento extranjero",
  },
  // El genérico que ya estaba aprobado (dueño, 30/10/2026; en las maquetas de caja, productos, stock y compras), con clave propia del módulo como los demás: no es un texto nuevo.
  "clientes.error.sin_permiso": { porDefecto: "Esta acción no está permitida" },
} as const;
