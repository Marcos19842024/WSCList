import React, { useState, useEffect, useRef } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute } from '@react-navigation/native';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as MediaLibrary from 'expo-media-library';
import Toast from 'react-native-toast-message';
import Icon from '@expo/vector-icons/MaterialIcons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { ChecklistData, ChecklistItem, ChecklistPhoto } from '../types/checklist';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  Alert,
  Modal,
} from 'react-native';
import { styleschecklist } from 'src/styles/checklist';
import 'react-native-get-random-values';
import * as Crypto from 'expo-crypto';

// Servicio compartido de Supabase
import {
  uploadPhotoToSupabase,
  deletePhotoFromSupabase,
} from 'src/services/supabaseStorageService';

// Storage local
import { loadDraft, clearDraft, saveDraft } from 'src/services/checklistStorage';

export const ChecklistScreen = () => {
  const route = useRoute();

  // Estados principales
  const [formData, setFormData] = useState<ChecklistData>();
  
  // ID único para este checklist (se genera una sola vez)
  const [checklistId] = useState<string>(Crypto.randomUUID());
  
  // Estados de UI
  const [cameraVisible, setCameraVisible] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [photoDescription, setPhotoDescription] = useState('');
  const [tempPhoto, setTempPhoto] = useState<string | null>(null);
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [uploadingPhotos, setUploadingPhotos] = useState<Record<string, boolean>>({});
  const areasScrollViewRef = useRef<ScrollView>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Solicitar permisos
  useEffect(() => {
    (async () => {
      const { status: cameraStatus } = await Camera.requestCameraPermissionsAsync();
      setHasCameraPermission(cameraStatus === 'granted');
      
      const { status: mediaStatus } = await MediaLibrary.requestPermissionsAsync();
      if (mediaStatus !== 'granted') {
        Alert.alert('Permiso necesario', 'Se necesita acceso a la galería para guardar fotos');
      }
    })();
  }, []);

  // Auto-save cada 30 segundos
  useEffect(() => {
    autoSaveTimerRef.current = setInterval(() => {
      saveProgressOnly();
    }, 30000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current);
      }
    };
  }, [formData]);

  // Cargar borrador al iniciar
  useEffect(() => {
    loadExistingDraft();
  }, []);

  // Guardar cambios importantes
  useEffect(() => {
    const debounceTimer = setTimeout(() => {
      if (formData.items.some(item => item.cumplimiento !== '')) {
        saveProgressOnly();
      }
    }, 5000);
    
    return () => clearTimeout(debounceTimer);
  }, [formData.items, formData.responsable, formData.comentariosAdicionales]);

  // ========== FUNCIONES DE FOTOS ==========

  // Tomar foto
  const takePhoto = async () => {
    if (hasCameraPermission === false) {
      Alert.alert('Permiso denegado', 'Necesitas permitir el acceso a la cámara');
      return;
    }

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.8,
        base64: false,
      });

      if (!result.canceled && result.assets[0]) {
        setTempPhoto(result.assets[0].uri);
        setCameraVisible(true);
      }
    } catch (error) {
      console.error('Error tomando foto:', error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'No se pudo tomar la foto',
      });
    }
  };

  // Guardar foto (subir a Storage inmediatamente)
  const savePhoto = async () => {
    if (!tempPhoto) return;

    const photoId = Crypto.randomUUID();

    try {
      const newPhoto: ChecklistPhoto = {
        id: photoId,
        photoUri: tempPhoto, // URI local temporal
        timestamp: getCurrentTime(),
        description: photoDescription,
      };

      // Actualizar estado primero
      setFormData(prev => ({
        ...prev,
        photos: [...(prev.photos || []), newPhoto]
      }));

      // Mostrar indicador de carga
      setUploadingPhotos(prev => ({ ...prev, [photoId]: true }));

      // Subir a Storage usando el servicio compartido
      const publicUrl = await uploadPhotoToSupabase(tempPhoto, checklistId, photoId);
      
      setUploadingPhotos(prev => ({ ...prev, [photoId]: false }));
      
      if (publicUrl) {
        // Actualizar la foto con la URL pública
        setFormData(prev => ({
          ...prev,
          photos: prev.photos?.map(p => 
            p.id === photoId 
              ? { ...p, photoUri: publicUrl, synced: true }
              : p
          ) || []
        }));
        
        Toast.show({
          type: 'success',
          text1: '✅ Foto subida a la nube',
          text2: 'Aparecerá como enlace en el PDF',
        });
      } else {
        Toast.show({
          type: 'warning',
          text1: '⚠️ Foto guardada localmente',
          text2: 'Se subirá cuando haya conexión',
        });
      }

      // Limpiar estado temporal
      setTempPhoto(null);
      setPhotoDescription('');
      setCameraVisible(false);
      
      // Guardar progreso
      saveProgressOnly();
      
    } catch (error) {
      console.error('Error guardando foto:', error);
      setUploadingPhotos(prev => ({ ...prev, [photoId || '']: false }));
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'No se pudo guardar la foto',
      });
    }
  };

  // Eliminar foto
  const removePhoto = (photoId: string) => {
    Alert.alert(
      'Eliminar foto',
      '¿Estás seguro de que deseas eliminar esta foto?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            // Eliminar de Storage usando el servicio compartido
            await deletePhotoFromSupabase(checklistId, photoId);
            
            // Eliminar del estado
            setFormData(prev => ({
              ...prev,
              photos: prev.photos?.filter(photo => photo.id !== photoId) || []
            }));
            
            Toast.show({
              type: 'success',
              text1: 'Foto eliminada',
            });
            
            saveProgressOnly();
          }
        }
      ]
    );
  };

  // Cargar borrador existente
  const loadExistingDraft = async () => {
    try {
      const draft = await loadDraft();
      if (draft) {
        Alert.alert(
          'Borrador encontrado',
          'Se encontró un progreso guardado. ¿Deseas continuar donde lo dejaste?',
          [
            { 
              text: 'Empezar nuevo', 
              style: 'cancel',
              onPress: () => clearDraft()
            },
            { 
              text: 'Continuar', 
              onPress: () => {
                setFormData(draft);
                Toast.show({
                  type: 'success',
                  text1: '✅ Progreso cargado',
                  text2: 'Continuando con el borrador guardado',
                });
              }
            }
          ]
        );
      }
    } catch (error) {
      console.error('Error cargando borrador:', error);
    }
  };

  // Guardar solo progreso (sin PDF)
  const saveProgressOnly = async () => {
    try {
      await saveDraft(formData);
      setLastSaved(new Date());
      console.log('📝 Progreso guardado automáticamente');
    } catch (error) {
      console.error('Error en autoguardado:', error);
    }
  };

  // Agrupar items por área
  const itemsByArea = formData.items.reduce((acc, item) => {
    if (!acc[item.area]) acc[item.area] = [];
    acc[item.area].push(item);
    return acc;
  }, {} as Record<string, ChecklistItem[]>);

  return (
    <SafeAreaView style={styleschecklist.container}>
      {/* SECCIÓN FIJA SUPERIOR */}
      <View style={styleschecklist.fixedSection}>
        {/* Header con botones */}
        <View style={styleschecklist.header}>
          <TouchableOpacity
            style={styleschecklist.headerButton}
            disabled={isLoading}
          >
            <Icon name="save" size={24} color="white" />
            <View>
              <Text style={styleschecklist.cameraButtonText}>Guardar</Text>

              {/* Info de último guardado */}
              {lastSaved && (
                <>
                  <Text style={styleschecklist.lastSavedText}>
                    Guardado automático:
                  </Text>
                  <Text style={styleschecklist.lastSavedText}>
                    {lastSaved.toLocaleTimeString()}
                  </Text>
                </>
              )}
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styleschecklist.headerButton}
            disabled={isLoading}
          >
            <Icon name="add-circle-outline" size={24} color="white" />
            <Text style={styleschecklist.cameraButtonText}>Nuevo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styleschecklist.cameraButton}
            onPress={takePhoto}
            disabled={hasCameraPermission === false || isLoading}
          >
            <MaterialCommunityIcons name="camera" size={24} color="white" />
            <Text style={styleschecklist.cameraButtonText}>Foto</Text>
          </TouchableOpacity>
        </View>

        {/* Información general */}
        <View style={styleschecklist.infoCard}>
          <View style={styleschecklist.infoGrid}>
            <Text style={styleschecklist.infoLabel}>FECHA:</Text>
            <Text style={styleschecklist.infoValue}>{formData.fecha}</Text>
            <View style={{ width: 8 }} />
            <Text style={styleschecklist.infoLabel}>HORA INICIO:</Text>
            <Text style={styleschecklist.infoValue}>{formData.horaInicio} hrs.</Text>
          </View>
          
          <View style={styleschecklist.infoItem}>
            <Text style={styleschecklist.infoLabel}>RESPONSABLE:</Text>
            <TextInput
              style={styleschecklist.responsableInput}
              placeholder="Nombre del responsable"
              value={formData.responsable}
              onChangeText={(text) => {
                setFormData(prev => ({ ...prev, responsable: text }));
                saveProgressOnly();
              }}
              editable={!isLoading}
            />
          </View>
        </View>

        {/* Barra de progreso general */}
        <View style={styleschecklist.progressCard}>
          <View style={styleschecklist.progressHeader}>
            <Text style={styleschecklist.progressLabel}>Calificación General</Text>
            <Text style={[
              styleschecklist.progressStatus
            ]}>
            </Text>
          </View>
          
          <View style={styleschecklist.progressBar}>
            <View 
              style={[
                styleschecklist.progressFill
              ]}
            />
          </View>
          
          <View style={styleschecklist.progressFooter}>
            <Text style={styleschecklist.progressText}>0%</Text>
            <Text style={[
              styleschecklist.progressText
            ]}>
            </Text>
            <Text style={styleschecklist.progressText}>100%</Text>
          </View>
        </View>
      </View>

      {/* SCROLLVIEW PARA LAS ÁREAS */}
      <ScrollView 
        ref={areasScrollViewRef}
        style={styleschecklist.areasScrollView}
        showsVerticalScrollIndicator={true}
      >

        {/* Comentarios adicionales */}
        <View style={styleschecklist.commentsSection}>
          <Text style={styleschecklist.sectionTitle}>Comentarios Adicionales</Text>
          <TextInput
            style={styleschecklist.commentsInput}
            placeholder="Ingrese comentarios adicionales aquí..."
            value={formData.comentariosAdicionales}
            onChangeText={(text) => setFormData(prev => ({ ...prev, comentariosAdicionales: text }))}
            onBlur={saveProgressOnly}
            multiline
            numberOfLines={4}
            editable={!isLoading}
          />
        </View>
      </ScrollView>

      {/* Modal de validación */}
      <Modal
        visible={showValidationModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowValidationModal(false)}
      >
        <View style={styleschecklist.validationModalOverlay}>
          <View style={styleschecklist.validationModalContent}>
            <View style={styleschecklist.validationHeader}>
              <MaterialCommunityIcons name="alert-circle" size={40} color="#F59E0B" />
              <Text style={styleschecklist.validationTitle}>Áreas Pendientes</Text>
            </View>
            
            <View style={styleschecklist.validationButtons}>
              <TouchableOpacity
                style={[styleschecklist.validationButton, styleschecklist.cancelValidationButton]}
                onPress={() => setShowValidationModal(false)}
                disabled={isLoading}
              >
                <Text style={styleschecklist.cancelValidationButtonText}>Cancelar</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styleschecklist.validationButton, styleschecklist.forceSaveButton]}
                disabled={isLoading}
              >
                <MaterialCommunityIcons name="file-document-outline" size={20} color="white" />
                <Text style={styleschecklist.forceSaveButtonText}>Guardar Incompleto</Text>
              </TouchableOpacity>
            </View>
            
            <Text style={styleschecklist.validationNote}>
              📝 Recomendación: Complete todas las áreas para un reporte más preciso
            </Text>
          </View>
        </View>
      </Modal>

      {/* Modal de foto */}
      <Modal
        visible={cameraVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setCameraVisible(false)}
      >
        <View style={styleschecklist.modalContainer}>
          <View style={styleschecklist.modalContent}>
            <Text style={styleschecklist.modalTitle}>Vista previa de foto</Text>
            
            {tempPhoto && (
              <Image source={{ uri: tempPhoto }} style={styleschecklist.previewImage} />
            )}
            
            <TextInput
              style={styleschecklist.descriptionInput}
              placeholder="Descripción de la foto (opcional)"
              value={photoDescription}
              onChangeText={setPhotoDescription}
              multiline
              editable={!isLoading}
            />
            
            <View style={styleschecklist.modalButtons}>
              <TouchableOpacity
                style={[styleschecklist.modalButton, styleschecklist.cancelButton]}
                onPress={() => {
                  setTempPhoto(null);
                  setCameraVisible(false);
                }}
                disabled={isLoading}
              >
                <Text style={styleschecklist.cancelButtonText}>Cancelar</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styleschecklist.modalButton, styleschecklist.savePhotoButton]}
                onPress={savePhoto}
                disabled={isLoading}
              >
                <Text style={styleschecklist.savePhotoButtonText}>Guardar Foto</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Toast />
    </SafeAreaView>
  );
};

function getCurrentTime(): string {
  const now = new Date();
  try {
    // Format as HH:MM (24-hour)
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch (e) {
    // Fallback
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }
}
