from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from .models import Comment, Follow, Like, Message, Post
from .serializers import (
    CommentSerializer,
    MessageSerializer,
    PostSerializer,
    ProfileDetailSerializer,
    ProfileSerializer,
    RegisterSerializer,
    UserSerializer,
)


# --------------------------------------------------------------------------- #
# Permissions
# --------------------------------------------------------------------------- #
class IsAuthorOrReadOnly(permissions.BasePermission):
    """Read for anyone; write/delete only for the object's author."""

    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True
        return obj.author_id == request.user.id


# --------------------------------------------------------------------------- #
# Root landing — a friendly index so hitting the server root isn't a 404
# --------------------------------------------------------------------------- #
@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def api_root(request):
    api = request.build_absolute_uri('/api/')
    return Response({
        'message': 'Orbit API is running. This backend serves JSON only — '
                   'open the frontend (index.html) to use the app.',
        'endpoints': {
            'register': api + 'auth/register/',
            'login': api + 'auth/login/',
            'me': api + 'auth/me/',
            'posts': api + 'posts/',
            'user_profile': api + 'users/<id>/',
        },
        'admin': request.build_absolute_uri('/admin/'),
    })


# --------------------------------------------------------------------------- #
# Auth: /api/auth/
# --------------------------------------------------------------------------- #
@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def register(request):
    serializer = RegisterSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    token, _ = Token.objects.get_or_create(user=user)
    return Response(
        {'token': token.key, 'user': UserSerializer(user, context={'request': request}).data},
        status=status.HTTP_201_CREATED,
    )


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def login_view(request):
    user = authenticate(
        username=request.data.get('username'),
        password=request.data.get('password'),
    )
    if user is None:
        return Response({'detail': 'Invalid username or password.'},
                        status=status.HTTP_400_BAD_REQUEST)
    token, _ = Token.objects.get_or_create(user=user)
    return Response({'token': token.key, 'user': UserSerializer(user, context={'request': request}).data})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def logout_view(request):
    # Invalidate the current token.
    Token.objects.filter(user=request.user).delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET', 'PATCH'])
@permission_classes([permissions.IsAuthenticated])
def me(request):
    """Fetch or update the logged-in user's own profile."""
    profile = request.user.profile
    if request.method == 'PATCH':
        serializer = ProfileSerializer(profile, data=request.data, partial=True,
                                       context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)
    return Response(ProfileDetailSerializer(profile, context={'request': request}).data)


# --------------------------------------------------------------------------- #
# Posts: /api/posts/
# --------------------------------------------------------------------------- #
class PostListCreate(generics.ListCreateAPIView):
    serializer_class = PostSerializer

    def get_queryset(self):
        qs = Post.objects.select_related('author', 'author__profile') \
                         .prefetch_related('likes', 'comments')
        author = self.request.query_params.get('author')
        if author:
            qs = qs.filter(author_id=author)
        # Global feed excludes your own posts (they live on your profile).
        if self.request.query_params.get('feed') and self.request.user.is_authenticated:
            qs = qs.exclude(author=self.request.user)
        return qs

    def perform_create(self, serializer):
        serializer.save(author=self.request.user)


class PostDetail(generics.RetrieveDestroyAPIView):
    queryset = Post.objects.select_related('author', 'author__profile')
    serializer_class = PostSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly, IsAuthorOrReadOnly]


# --------------------------------------------------------------------------- #
# Comments: /api/posts/<id>/comments/
# --------------------------------------------------------------------------- #
class CommentListCreate(generics.ListCreateAPIView):
    serializer_class = CommentSerializer

    def get_queryset(self):
        return Comment.objects.filter(post_id=self.kwargs['post_id']) \
                              .select_related('author', 'author__profile')

    def perform_create(self, serializer):
        post = get_object_or_404(Post, pk=self.kwargs['post_id'])
        serializer.save(author=self.request.user, post=post)


# --------------------------------------------------------------------------- #
# Likes: /api/posts/<id>/like/  (toggle)
# --------------------------------------------------------------------------- #
@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def toggle_like(request, post_id):
    post = get_object_or_404(Post, pk=post_id)
    like, created = Like.objects.get_or_create(user=request.user, post=post)
    if not created:
        like.delete()
    return Response({'liked': created, 'like_count': post.likes.count()})


# --------------------------------------------------------------------------- #
# Users / profiles: /api/users/
# --------------------------------------------------------------------------- #
@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def user_search(request):
    """Find users by username, annotated with the viewer's follow status."""
    query = request.query_params.get('q', '').strip()
    if not query:
        return Response([])
    users = (User.objects.filter(username__icontains=query)
             .exclude(id=request.user.id)
             .select_related('profile')
             .order_by('username')[:20])
    data = ProfileSerializer([u.profile for u in users], many=True,
                             context={'request': request}).data
    return Response(data)


class ProfileDetail(generics.RetrieveAPIView):
    """Public profile by username, including that user's posts."""
    serializer_class = ProfileDetailSerializer

    def get_object(self):
        user = get_object_or_404(User.objects.select_related('profile'),
                                 username=self.kwargs['username'])
        return user.profile


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def toggle_follow(request, user_id):
    target = get_object_or_404(User, pk=user_id)
    if target == request.user:
        return Response({'detail': "You can't follow yourself."},
                        status=status.HTTP_400_BAD_REQUEST)
    follow, created = Follow.objects.get_or_create(follower=request.user, following=target)
    if not created:
        follow.delete()
    return Response({'following': created, 'follower_count': target.followers.count()})


# --------------------------------------------------------------------------- #
# Direct messages: /api/messages/
# --------------------------------------------------------------------------- #
@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def conversations(request):
    """Inbox: one entry per person the user has exchanged messages with."""
    me = request.user
    msgs = (Message.objects.filter(Q(sender=me) | Q(recipient=me))
            .select_related('sender', 'recipient', 'sender__profile', 'recipient__profile'))

    threads = {}  # other_user_id -> {user, last, unread}
    for m in msgs:  # ordered oldest→newest, so the last seen is the most recent
        other = m.recipient if m.sender_id == me.id else m.sender
        thread = threads.setdefault(other.id, {'user': other, 'last': None, 'unread': 0})
        thread['last'] = m
        if m.recipient_id == me.id and not m.read_status:
            thread['unread'] += 1

    result = [{
        'user': UserSerializer(t['user'], context={'request': request}).data,
        'last_message': t['last'].content,
        'timestamp': t['last'].timestamp,
        'unread': t['unread'],
    } for t in threads.values()]
    result.sort(key=lambda x: x['timestamp'], reverse=True)
    return Response(result)


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def conversation(request, user_id):
    """Full message history with one user; marks their messages as read."""
    other = get_object_or_404(User, pk=user_id)
    me = request.user
    msgs = (Message.objects.filter(
                Q(sender=me, recipient=other) | Q(sender=other, recipient=me))
            .select_related('sender', 'recipient', 'sender__profile', 'recipient__profile'))

    # Mark the other person's messages to me as read.
    Message.objects.filter(sender=other, recipient=me, read_status=False).update(read_status=True)

    return Response({
        'user': UserSerializer(other, context={'request': request}).data,
        'messages': MessageSerializer(msgs, many=True, context={'request': request}).data,
    })


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def send_message(request):
    recipient_id = request.data.get('recipient')
    content = (request.data.get('content') or '').strip()
    if not content:
        return Response({'detail': 'Message cannot be empty.'}, status=status.HTTP_400_BAD_REQUEST)
    recipient = get_object_or_404(User, pk=recipient_id)
    if recipient == request.user:
        return Response({'detail': "You can't message yourself."},
                        status=status.HTTP_400_BAD_REQUEST)
    msg = Message.objects.create(sender=request.user, recipient=recipient, content=content)
    return Response(MessageSerializer(msg, context={'request': request}).data,
                    status=status.HTTP_201_CREATED)
