// Logica de UI, envio resiliente (Outbox) y respaldo para navegadores sin SyncManager.
// Solo promesas explicitas: Promise, .then(), .catch() y Promise.all().

const ENDPOINT = 'https://jsonplaceholder.typicode.com/posts';

// ---------- Service Worker y mensajes (Fragmento G) ----------
if ('serviceWorker' in navigator) {
  // Segunda mitad del puente: recibe el aviso que envia sw.js con postMessage
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data && event.data.tipo === 'OUTBOX_SINCRONIZADO') {
      console.log('[UI] Confirmación recibida del Service Worker. Actualizando bandeja...');
      renderizarColaOutbox();
    }
  });

  // Ruta relativa: en GitHub Pages el scope queda en /pwa-outbox-practica/
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then((reg) => console.log('[SW] Registrado con scope:', reg.scope))
      .catch((err) => console.error('[SW] Error al registrar:', err));
  });
}

// ---------- Indicador de red ----------
function actualizarIndicadorRed() {
  const badge = document.getElementById('badge-red');
  if (navigator.onLine) {
    badge.textContent = 'En Línea';
    badge.className = 'badge online';
  } else {
    badge.textContent = 'Sin Conexión';
    badge.className = 'badge offline';
  }
}

// ---------- READ: dibujar la bandeja ----------
function renderizarColaOutbox() {
  return obtenerTodosLosRegistros().then((registros) => {
    const lista = document.getElementById('lista-outbox');
    lista.innerHTML = '';

    if (registros.length === 0) {
      const vacio = document.createElement('li');
      vacio.className = 'vacio';
      vacio.textContent = 'La bandeja está vacía.';
      lista.appendChild(vacio);
      return;
    }

    registros.forEach((item) => {
      const li = document.createElement('li');

      const titulo = document.createElement('strong');
      titulo.textContent = item.titulo;

      const estado = document.createElement('span');
      estado.className = 'estado ' + item.estado;
      estado.textContent = item.estado;

      const hora = document.createElement('small');
      hora.textContent = new Date(item.fechaCreacion).toLocaleTimeString();

      li.appendChild(titulo);
      li.appendChild(estado);
      li.appendChild(hora);
      lista.appendChild(li);
    });
  });
}

// ---------- CREATE: envio resiliente (Fragmentos B y E) ----------
function procesarEnvioReporte(datosFormulario) {
  return fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: datosFormulario.titulo, body: datosFormulario.descripcion })
  })
    .then((respuesta) => {
      if (!respuesta.ok) throw new Error('Error HTTP del servidor');
      return respuesta.json();
    })
    .then(() => {
      return guardarRegistro({
        ...datosFormulario,
        estado: 'sincronizado',
        fechaCreacion: Date.now()
      });
    })
    .catch(() => {
      console.warn('[Outbox] Sin conexión. Encolando en IndexedDB...');

      return guardarRegistro({
        ...datosFormulario,
        estado: 'pendiente',
        fechaCreacion: Date.now()
      }).then(() => {
        // Delegar el reenvio al Service Worker si el navegador soporta Background Sync
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
          return navigator.serviceWorker.ready.then((registro) => {
            console.log('[Outbox] Registrando etiqueta sync-reportes en el SW...');
            return registro.sync.register('sync-reportes');
          });
        }
      });
    })
    .then(() => renderizarColaOutbox());
}

// ---------- UPDATE: respaldo para navegadores sin SyncManager (Fragmento C) ----------
function sincronizarPendientesFallback() {
  console.log('[Outbox] Buscando registros pendientes...');

  return obtenerTodosLosRegistros()
    .then((registros) => {
      const pendientes = registros.filter((item) => item.estado === 'pendiente');

      if (pendientes.length === 0) {
        console.log('[Outbox] No hay transacciones pendientes por sincronizar.');
        return;
      }

      // Cada registro pendiente se convierte en una promesa (POST + update en IndexedDB)
      const promesasDeEnvio = pendientes.map((item) => {
        return fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: item.titulo, body: item.descripcion })
        }).then((res) => {
          if (!res.ok) throw new Error('Falla al reintentar envío');
          return actualizarEstadoRegistro(item.id, 'sincronizado');
        });
      });

      return Promise.all(promesasDeEnvio);
    })
    .then(() => renderizarColaOutbox())
    .catch((error) => {
      console.error('[Outbox] Error durante la sincronización masiva:', error);
    });
}

// ---------- Evento online (Fragmento F) ----------
window.addEventListener('online', () => {
  actualizarIndicadorRed();

  // Solo si NO hay Background Sync (Safari/iOS, Firefox); si no, sw.js y app.js duplicarian el POST
  if (!('SyncManager' in window)) {
    console.log('[Outbox] Navegador sin SyncManager. Ejecutando fallback por evento online...');
    sincronizarPendientesFallback();
  }
});

window.addEventListener('offline', actualizarIndicadorRed);

// ---------- Formulario (submit) ----------
document.getElementById('form-incidencia').addEventListener('submit', (e) => {
  e.preventDefault();

  const inputTitulo = document.getElementById('titulo');
  const inputDescripcion = document.getElementById('descripcion');

  const datos = {
    titulo: inputTitulo.value.trim(),
    descripcion: inputDescripcion.value.trim()
  };

  procesarEnvioReporte(datos)
    .then(() => {
      e.target.reset();
    })
    .catch((error) => {
      console.error('[Outbox] No se pudo guardar el reporte:', error);
    });
});

// ---------- DELETE: purgar sincronizados ----------
document.getElementById('btn-purgar').addEventListener('click', () => {
  obtenerTodosLosRegistros()
    .then((registros) => {
      const sincronizados = registros.filter((item) => item.estado === 'sincronizado');
      return Promise.all(sincronizados.map((item) => eliminarRegistro(item.id)));
    })
    .then(() => renderizarColaOutbox())
    .catch((error) => {
      console.error('[Outbox] Error al purgar:', error);
    });
});

// ---------- Arranque: READ al cargar la pagina ----------
actualizarIndicadorRed();
renderizarColaOutbox()
  .then(() => {
    // Sin SyncManager, reintentar al abrir la app si ya hay red
    if (!('SyncManager' in window) && navigator.onLine) {
      return sincronizarPendientesFallback();
    }
  })
  .catch((error) => console.error('[Outbox] Error al iniciar:', error));
