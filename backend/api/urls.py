from django.urls import path

from . import views

urlpatterns = [
    # Index
    path('', views.api_root, name='api-root'),

    # Auth
    path('auth/register/', views.register, name='register'),
    path('auth/login/', views.login_view, name='login'),
    path('auth/logout/', views.logout_view, name='logout'),
    path('auth/me/', views.me, name='me'),

    # Posts
    path('posts/', views.PostListCreate.as_view(), name='post-list'),
    path('posts/bookmarks/', views.bookmarked_posts, name='bookmarked-posts'),
    path('posts/<int:pk>/', views.PostDetail.as_view(), name='post-detail'),

    # Comments
    path('posts/<int:post_id>/comments/', views.CommentListCreate.as_view(), name='post-comments'),

    # Likes and Bookmarks
    path('posts/<int:post_id>/like/', views.toggle_like, name='post-like'),
    path('posts/<int:post_id>/bookmark/', views.toggle_bookmark, name='post-bookmark'),

    # Users / search / follows
    path('users/search/', views.user_search, name='user-search'),
    path('users/<int:user_id>/follow/', views.toggle_follow, name='user-follow'),
    path('users/<str:username>/', views.ProfileDetail.as_view(), name='user-profile'),

    # Direct messages
    path('messages/', views.conversations, name='conversations'),
    path('messages/send/', views.send_message, name='message-send'),
    path('messages/<int:user_id>/', views.conversation, name='conversation'),

    # Notifications
    path('notifications/', views.notifications_list, name='notifications-list'),
    path('notifications/<int:notif_id>/read/', views.mark_notification_read, name='notification-read'),
]
