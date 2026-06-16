import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Provider as PaperProvider } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import StudentListScreen from './screens/StudentListScreen';
import DailyEntryScreen from './screens/DailyEntryScreen';
import ExportScreen from './screens/ExportScreen';

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <PaperProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            tabBarIcon: ({ color, size }) => {
              let iconName;
              if (route.name === 'Estudiantes') iconName = 'account-group';
              else if (route.name === 'Registro Diario') iconName = 'calendar-check';
              else if (route.name === 'Exportar') iconName = 'file-excel';
              return <Icon name={iconName} size={size} color={color} />;
            },
            tabBarActiveTintColor: '#0d47a1',
            tabBarInactiveTintColor: 'gray',
          })}
        >
          <Tab.Screen name="Estudiantes" component={StudentListScreen} />
          <Tab.Screen name="Registro Diario" component={DailyEntryScreen} />
          <Tab.Screen name="Exportar" component={ExportScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </PaperProvider>
  );
}